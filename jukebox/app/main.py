from __future__ import annotations

import asyncio
import hashlib
import os
import random
import socket
import time
from pathlib import Path
from typing import Any
from urllib.parse import urlencode

import httpx
from fastapi import FastAPI, File, HTTPException, Query, Request, Response, UploadFile
from fastapi.responses import FileResponse, HTMLResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from .folder_albums import (
    build_folder_album,
    collapse_album_list,
    invalidate_caches,
    resolve_folder_key,
    warm_folder_caches,
)
from .locate import locate_album, locate_song
from . import meta_overrides as meta
from . import playlist as playlist_store

NAVIDROME = os.environ.get("NAVIDROME_URL", "http://127.0.0.1:4533").rstrip("/")
USER = os.environ.get("JUKEBOX_USER", "jukebox")
PASSWORD = os.environ.get("JUKEBOX_PASSWORD", "")
STATIC = Path(__file__).resolve().parent.parent / "static"
NAVIDROME_DB = os.environ.get("NAVIDROME_DB", "/data/navidrome.db")
VINYL_DATA = Path(os.environ.get("VINYL_DATA", "/vinyl-data"))

app = FastAPI(title="Cindy Vinyl", docs_url=None, redoc_url=None)

_http: httpx.AsyncClient | None = None
_alpha_lock = asyncio.Lock()
_alpha_index: list[tuple[str, dict[str, Any]]] | None = None
_alpha_built = 0.0
_ALPHA_TTL = 600.0
_letter_lock = asyncio.Lock()
_letter_cache: dict[str, list[dict[str, Any]]] = {}
_letter_cache_built: dict[str, float] = {}
_LETTER_TTL = 600.0
_letter_full_cache: dict[tuple[str, str], tuple[list[dict[str, Any]], str, float]] = {}
_LETTER_FULL_TTL = 300.0
_LETTER_FETCH_CAP = 10000
_genres_lock = asyncio.Lock()
_genres_cache: list[dict[str, Any]] | None = None
_genres_built = 0.0
_GENRES_TTL = 600.0
_available_letters_lock = asyncio.Lock()
_available_letters_cache: list[str] | None = None
_available_letters_built = 0.0
_AVAILABLE_LETTERS_TTL = 600.0
_alpha_warm_task: asyncio.Task | None = None
_random_good_cache: list[dict[str, Any]] = []
_RANDOM_GOOD_CAP = 24
_SQLITE_BUSY_TIMEOUT_MS = 30_000


class AlbumMetaPatch(BaseModel):
    id: str = Field(min_length=1)
    name: str | None = None
    artist: str | None = None


class SongMetaPatch(BaseModel):
    id: str = Field(min_length=1)
    title: str | None = None
    artist: str | None = None
    album: str | None = None


class CoverFromUrl(BaseModel):
    url: str = Field(min_length=1)


class PlaylistAdd(BaseModel):
    id: str = Field(min_length=1)
    title: str | None = None
    artist: str | None = None
    album: str | None = None
    coverArt: str | None = None
    duration: float | None = None


class PlaylistAddMany(BaseModel):
    tracks: list[PlaylistAdd] = Field(min_length=1)


def _auth_params() -> dict[str, str]:
    if not PASSWORD:
        raise HTTPException(503, "JUKEBOX_PASSWORD not configured")
    salt = f"{random.randint(100000, 999999)}"
    token = hashlib.md5(f"{PASSWORD}{salt}".encode()).hexdigest()
    return {"u": USER, "t": token, "s": salt, "v": "1.16.1", "c": "cindy-vinyl", "f": "json"}


async def _http_client() -> httpx.AsyncClient:
    global _http
    if _http is None or _http.is_closed:
        _http = httpx.AsyncClient(timeout=60.0, limits=httpx.Limits(max_connections=24, max_keepalive_connections=12))
    return _http


async def _nd_get(view: str, extra: dict[str, Any] | None = None) -> dict[str, Any]:
    params = _auth_params()
    if extra:
        params.update({k: str(v) for k, v in extra.items() if v is not None})
    url = f"{NAVIDROME}/rest/{view}"
    client = await _http_client()
    r = await client.get(url, params=params)
    if r.status_code >= 400:
        raise HTTPException(r.status_code, r.text[:400])
    data = r.json()
    sub = data.get("subsonic-response") or {}
    if sub.get("status") != "ok":
        err = sub.get("error") or {}
        raise HTTPException(502, err.get("message") or "Navidrome error")
    return sub


def _sqlite_ro():
    import sqlite3
    con = sqlite3.connect(f"file:{NAVIDROME_DB}?mode=ro", uri=True, timeout=_SQLITE_BUSY_TIMEOUT_MS / 1000.0)
    con.execute(f"PRAGMA busy_timeout={_SQLITE_BUSY_TIMEOUT_MS}")
    return con


@app.get("/api/debug/request-path")
async def debug_request_path(request: Request):
    db_exists = os.path.isfile(NAVIDROME_DB)
    db_size = os.path.getsize(NAVIDROME_DB) if db_exists else None
    album_count = None
    db_error = None
    try:
        con = _sqlite_ro()
        album_count = int(con.execute("SELECT COUNT(*) FROM album").fetchone()[0])
        con.close()
    except Exception as exc:
        db_error = repr(exc)
    nav_ok = False
    nav_error = None
    try:
        sub = await _nd_get("ping.view")
        nav_ok = sub.get("status") == "ok"
    except Exception as exc:
        nav_error = repr(exc)
    return {
        "client": request.client.host if request.client else None,
        "host_header": request.headers.get("host"),
        "pid": os.getpid(),
        "hostname": socket.gethostname(),
        "navidrome_url": NAVIDROME,
        "navidrome_ok": nav_ok,
        "navidrome_error": nav_error,
        "db_path": NAVIDROME_DB,
        "db_exists": db_exists,
        "db_size": db_size,
        "album_count": album_count,
        "db_error": db_error,
        "random_cache_size": len(_random_good_cache),
    }


_VA_ARTISTS = frozenset({"various artists","various artist","various","va","v.a.","v.a","v/a","v / a"})


def _strip_leading_article(name: str) -> str:
    name = (name or "").strip().lstrip(" \t\"'`“”‘’.,")
    upper = name.upper()
    for prefix in ("THE ", "A ", "AN "):
        if upper.startswith(prefix):
            return name[len(prefix):].lstrip(" \t\"'`“”‘’.,")
    return name


def _significant_artist(album: dict[str, Any]) -> str:
    return _strip_leading_article(album.get("artist") or album.get("displayArtist") or "")


def _is_va_album(album: dict[str, Any]) -> bool:
    artist = (album.get("artist") or album.get("displayArtist") or "").strip().lower()
    if artist in _VA_ARTISTS or artist.startswith("various artist"):
        return True
    return bool(album.get("compilation"))


def _album_index_letter(album: dict[str, Any]) -> str:
    if _is_va_album(album): return "VA"
    name = _significant_artist(album)
    if not name: return "#"
    ch = name[0].upper()
    return ch if ch.isalpha() else "#"


def _raw_sort_rank(album: dict[str, Any]) -> int:
    if _is_va_album(album): return 27
    name = _significant_artist(album)
    if not name: return 0
    c = name[0].upper()
    return ord(c)-ord("A")+1 if c.isalpha() else 0


def _slim_album(a: dict[str, Any]) -> dict[str, Any]:
    return {"id":a.get("id"),"name":a.get("name") or a.get("title"),"artist":a.get("artist") or a.get("displayArtist"),"coverArt":a.get("coverArt"),"songCount":a.get("songCount"),"year":a.get("year"),"sortName":a.get("sortName"),"compilation":a.get("compilation")}


async def _fetch_alpha_page(offset:int,size:int)->list[dict[str,Any]]:
    sub=await _nd_get("getAlbumList2.view",{"type":"alphabeticalByArtist","size":str(size),"offset":str(max(0,offset))})
    raw=(sub.get("albumList2") or {}).get("album") or []
    if isinstance(raw,dict): raw=[raw]
    return meta.apply_album_list(raw)


async def _bisect_raw_letter(ch:str)->int:
    target=ord(ch.upper())-ord("A")+1; lo=0; hi=4096
    for _ in range(18):
        page=await _fetch_alpha_page(hi,1)
        if not page or _raw_sort_rank(page[0])>=target: break
        hi=min(hi*2,250_000)
    while lo<hi:
        mid=(lo+hi)//2; page=await _fetch_alpha_page(mid,1)
        if not page: hi=mid; continue
        if _raw_sort_rank(page[0])<target: lo=mid+1
        else: hi=mid
    return max(0,lo-80)


async def _seek_letter_albums(ch:str)->list[dict[str,Any]]:
    ch=ch.upper(); found=[]; seen=set()
    def consider(page):
        for a in page:
            if _album_index_letter(a)!=ch: continue
            aid=str(a.get("id") or "")
            if not aid or aid in seen: continue
            seen.add(aid); found.append(_slim_album(a))
    page_size=200
    if ch=="VA":
        offset=0
        for _ in range(250):
            page=await _fetch_alpha_page(offset,page_size)
            if not page: break
            consider(page); offset+=len(page)
            if len(page)<page_size: break
        return found
    offset=0
    for _ in range(40):
        page=await _fetch_alpha_page(offset,page_size)
        if not page: break
        consider(page); offset+=len(page)
        if _raw_sort_rank(page[-1])>=1 or len(page)<page_size: break
    if ch=="#": return found
    start=await _bisect_raw_letter(ch); offset=start; target=ord(ch)-ord("A")+1; empty_streak=0
    for _ in range(80):
        page=await _fetch_alpha_page(offset,page_size)
        if not page: break
        before=len(found); consider(page); empty_streak = empty_streak+1 if len(found)==before else 0
        last_rank=_raw_sort_rank(page[-1]); offset+=len(page)
        if last_rank>target and offset>start+100: break
        if empty_streak>=8 and last_rank>target: break
        if len(page)<page_size: break
    return found


_LETTER_ARTIST_ORD="lower(COALESCE(NULLIF(order_album_artist_name,''), NULLIF(sort_album_artist_name,''), album_artist))"
_LETTER_TITLE_ORD="lower(COALESCE(NULLIF(order_album_name,''), NULLIF(sort_album_name,''), name))"
_VA_WHERE_SQL="""(lower(trim(album_artist)) IN ('various artists','various artist','various','va','v.a.','v.a','v/a','v / a') OR lower(trim(album_artist)) LIKE 'various artist%' OR compilation = 1)"""
LETTER_CHARS=[*"ABCDEFGHIJKLMNOPQRSTUVWXYZ","VA","#"]


def _letter_where(ch:str)->tuple[str,tuple[Any,...],str]:
    ch=(ch or "A").upper(); artist_ord=_LETTER_ARTIST_ORD; order_by=f"{artist_ord}, {_LETTER_TITLE_ORD}"
    if ch=="VA": return f"COALESCE(missing, 0) = 0 AND {_VA_WHERE_SQL}",(),order_by
    if ch=="#": return f"COALESCE(missing, 0) = 0 AND NOT {_VA_WHERE_SQL} AND substr({artist_ord}, 1, 1) NOT BETWEEN 'a' AND 'z'",(),order_by
    return f"COALESCE(missing, 0) = 0 AND NOT {_VA_WHERE_SQL} AND {artist_ord} LIKE ?",(f"{ch.lower()}%",),order_by


def _albums_by_letter_db(ch:str,size:int,offset:int=0)->tuple[list[dict[str,Any]],int]|None:
    import sqlite3
    if not os.path.isfile(NAVIDROME_DB): return None
    try: con=_sqlite_ro(); con.row_factory=sqlite3.Row
    except sqlite3.Error: return None
    try:
        where,params,order_by=_letter_where(ch)
        total=int(con.execute(f"SELECT COUNT(*) FROM album WHERE {where}",params).fetchone()[0])
        rows=con.execute(f"SELECT id,name,album_artist,song_count,max_year,compilation,order_album_name,sort_album_name,order_album_artist_name,sort_album_artist_name FROM album WHERE {where} ORDER BY {order_by} LIMIT ? OFFSET ?",(*params,int(size),int(offset))).fetchall()
    except sqlite3.Error: return None
    finally: con.close()
    out=[]
    for r in rows:
        aid=r["id"]
        out.append({"id":aid,"name":r["name"],"artist":r["album_artist"] or "Various Artists","coverArt":aid,"songCount":r["song_count"],"year":r["max_year"] or None,"sortName":r["sort_album_name"] or r["order_album_name"] or "","compilation":bool(r["compilation"])})
    return out,total


def _available_letters_db()->list[str]|None:
    import sqlite3
    if not os.path.isfile(NAVIDROME_DB): return None
    try: con=_sqlite_ro()
    except sqlite3.Error: return None
    try:
        artist_ord=_LETTER_ARTIST_ORD
        rows=con.execute(f"SELECT CASE WHEN substr({artist_ord},1,1) BETWEEN 'a' AND 'z' THEN upper(substr({artist_ord},1,1)) ELSE '#' END AS ch, COUNT(*) AS n FROM album WHERE COALESCE(missing,0)=0 AND NOT {_VA_WHERE_SQL} GROUP BY 1").fetchall()
        present={str(r[0]) for r in rows if int(r[1] or 0)>0}
        va_where,va_params,_=_letter_where("VA")
        if int(con.execute(f"SELECT EXISTS(SELECT 1 FROM album WHERE {va_where})",va_params).fetchone()[0])>0: present.add("VA")
        return [ch for ch in LETTER_CHARS if ch in present]
    except sqlite3.Error: return None
    finally: con.close()


async def _letter_albums_cached(ch:str)->list[dict[str,Any]]:
    ch=ch.upper(); now=time.monotonic(); cached=_letter_cache.get(ch); built=_letter_cache_built.get(ch,0.0); ttl=45.0 if cached is not None and len(cached)==0 else _LETTER_TTL
    if cached is not None and now-built<ttl: return cached
    if _alpha_index is not None and now-_alpha_built<_ALPHA_TTL:
        matched=[a for L,a in _alpha_index if L==ch]; _letter_cache[ch]=matched; _letter_cache_built[ch]=now; return matched
    async with _letter_lock:
        matched=await _seek_letter_albums(ch)
        if matched: _letter_cache[ch]=matched; _letter_cache_built[ch]=time.monotonic()
        return matched


def _collapse_apply(albums:list[dict[str,Any]])->list[dict[str,Any]]: return meta.apply_album_list(collapse_album_list(albums))

def _filter_letter_sleeves(albums:list[dict[str,Any]],ch:str)->list[dict[str,Any]]:
    key=(ch or "A").upper(); out=[]; seen=set()
    for a in albums:
        if _album_index_letter(a)!=key: continue
        aid=str(a.get("id") or "")
        if not aid or aid in seen: continue
        seen.add(aid); out.append(a)
    return out

def _sort_collapsed(collapsed:list[dict[str,Any]],sort:str)->list[dict[str,Any]]:
    if sort=="album": return sorted(collapsed,key=lambda a:((a.get("sortName") or a.get("name") or "").lower(),(a.get("artist") or "").lower()))
    return collapsed

async def _letter_collapsed_full(ch:str,sort:str="artist")->tuple[list[dict[str,Any]],str]:
    key=(ch or "A").upper(); cache_key=(key,sort); now=time.monotonic(); cached=_letter_full_cache.get(cache_key)
    if cached is not None and now-cached[2]<_LETTER_FULL_TTL: return cached[0],cached[1]
    db=await asyncio.to_thread(_albums_by_letter_db,key,_LETTER_FETCH_CAP,0)
    if db is not None:
        albums,total=db
        if total>len(albums):
            extra=await asyncio.to_thread(_albums_by_letter_db,key,total-len(albums),len(albums))
            if extra and extra[0]: albums+=extra[0]
        collapsed=_sort_collapsed(_filter_letter_sleeves(await asyncio.to_thread(_collapse_apply,albums),key),sort)
        if collapsed: _letter_full_cache[cache_key]=(collapsed,"db",time.monotonic())
        return collapsed,"db"
    matched=await _letter_albums_cached(key); collapsed=_sort_collapsed(_filter_letter_sleeves(await asyncio.to_thread(_collapse_apply,matched),key),sort); mode="seek" if _alpha_index is None else "index"
    if collapsed: _letter_full_cache[cache_key]=(collapsed,mode,time.monotonic())
    return collapsed,mode

async def _letter_rail(ch:str,size:int,offset:int=0,sort:str="artist")->tuple[list[dict[str,Any]],int,str]:
    full,mode=await _letter_collapsed_full(ch,sort); offset=max(0,int(offset)); size=max(1,int(size)); return full[offset:offset+size],len(full),mode

async def _ensure_alpha_index(force:bool=False)->list[tuple[str,dict[str,Any]]]:
    global _alpha_index,_alpha_built,_letter_cache,_letter_cache_built
    out=[]; seen=set(); page_size=500
    for page in range(200):
        raw_page=await _fetch_alpha_page(page*page_size,page_size)
        if not raw_page: break
        for a in raw_page:
            aid=str(a.get("id") or "")
            if not aid or aid in seen: continue
            seen.add(aid); slim=_slim_album(a); out.append((_album_index_letter(slim),slim))
        if len(raw_page)<page_size: break
    if out:
        _alpha_index=out; _alpha_built=time.monotonic(); by_letter={}
        for L,a in out: by_letter.setdefault(L,[]).append(a)
        _letter_cache=by_letter; _letter_cache_built={k:_alpha_built for k in by_letter}
    return out

async def _ensure_genre_buckets(force:bool=False)->list[dict[str,Any]]:
    global _genres_cache,_genres_built
    sub=await _nd_get("getGenres.view",{}); _genres_cache=_genre_buckets(_parse_genre_rows(sub)); _genres_built=time.monotonic(); return _genres_cache

async def _ensure_available_letters(force:bool=False)->list[str]:
    global _available_letters_cache,_available_letters_built
    letters=await asyncio.to_thread(_available_letters_db)
    if letters is None: letters=list(LETTER_CHARS)
    _available_letters_cache=letters; _available_letters_built=time.monotonic(); return letters

@app.on_event("startup")
async def _warm_crate_caches()->None:
    try: await asyncio.to_thread(warm_folder_caches)
    except Exception: pass
    try: await _letter_rail("A",36)
    except Exception: pass


def _expand_album(album:dict[str,Any])->dict[str,Any]:
    aid=album.get("id") or ""; fk=resolve_folder_key(aid)
    if not fk: return meta.apply_album(album) or album
    merged=build_folder_album(fk); return meta.apply_album(merged or album) or album

@app.get("/api/health")
async def health():
    try:
        sub=await _nd_get("ping.view"); return {"ok":True,"navidrome":sub.get("status"),"user":USER}
    except Exception as exc: return {"ok":False,"error":str(exc)}


def _random_albums_db(size:int=40)->list[dict[str,Any]]|None:
    import sqlite3
    if not os.path.isfile(NAVIDROME_DB): return None
    try: con=_sqlite_ro(); con.row_factory=sqlite3.Row
    except sqlite3.Error: return None
    try:
        rows=con.execute("SELECT id,name,album_artist,song_count,max_year,compilation,order_album_name,sort_album_name FROM album WHERE COALESCE(missing,0)=0 AND COALESCE(song_count,0)>0 ORDER BY RANDOM() LIMIT ?",(max(1,int(size)),)).fetchall()
    except sqlite3.Error: return None
    finally: con.close()
    return [{"id":r["id"],"name":r["name"],"artist":r["album_artist"] or "Various Artists","coverArt":r["id"],"songCount":r["song_count"],"year":r["max_year"] or None,"sortName":r["sort_album_name"] or r["order_album_name"] or "","compilation":bool(r["compilation"])} for r in rows]


def _remember_random(album:dict[str,Any])->None:
    aid=str(album.get("id") or "")
    if not aid: return
    _random_good_cache[:]=[a for a in _random_good_cache if str(a.get("id") or "")!=aid]; _random_good_cache.insert(0,album); del _random_good_cache[_RANDOM_GOOD_CAP:]

@app.get("/api/random-album")
async def random_album():
    albums=[]
    for attempt in range(3):
        try:
            sub=await _nd_get("getAlbumList2.view",{"type":"random","size":24}); albums=(sub.get("albumList2") or {}).get("album") or []
        except HTTPException: albums=[]
        if not albums:
            try:
                sub=await _nd_get("getAlbumList2.view",{"type":"newest","size":40}); albums=(sub.get("albumList2") or {}).get("album") or []
            except HTTPException: albums=[]
        if not albums: albums=await asyncio.to_thread(_random_albums_db,40) or []
        if albums: break
        if attempt<2: await asyncio.sleep(0.6*(attempt+1))
    if not albums:
        if _random_good_cache: return random.choice(_random_good_cache)
        raise HTTPException(503,"Navidrome is busy indexing — try Spin again in a moment")
    albums=await asyncio.to_thread(_collapse_apply,albums)
    if not albums:
        if _random_good_cache: return random.choice(_random_good_cache)
        raise HTTPException(503,"Navidrome is busy indexing — try Spin again in a moment")
    last_exc=None; picks=list(albums); random.shuffle(picks)
    for album in picks[:12]:
        aid=str(album.get("id") or "")
        if not aid: continue
        for attempt in range(2):
            try:
                detail=await album_detail(aid); _remember_random(detail); return detail
            except HTTPException as exc:
                last_exc=exc
                if exc.status_code==404: break
                if attempt==0: await asyncio.sleep(0.5)
    if _random_good_cache: return random.choice(_random_good_cache)
    if last_exc: raise last_exc
    raise HTTPException(503,"Navidrome is busy indexing — try Spin again in a moment")


_CANONICAL_GENRES=("Rock","Pop","Country","Hip-Hop","R&B","Soul","Jazz","Blues","Metal","Punk","Indie","Electronic","Classical","Folk","Reggae","Soundtrack","Latin","Gospel","World")
_GENRE_RULES=(("country","Country"),("bluegrass","Country"),("americana","Country"),("nashville","Country"),("hip hop","Hip-Hop"),("hip-hop","Hip-Hop"),("hiphop","Hip-Hop"),("rap","Hip-Hop"),("trap","Hip-Hop"),("r&b","R&B"),("rnb","R&B"),("rhythm and blues","R&B"),("rhythm & blues","R&B"),("motown","Soul"),("soul","Soul"),("funk","Soul"),("disco","Soul"),("jazz","Jazz"),("blues","Blues"),("metal","Metal"),("punk","Punk"),("indie","Indie"),("alternative","Indie"),("alt ","Indie"),("electronic","Electronic"),("electronica","Electronic"),("dance","Electronic"),("edm","Electronic"),("house","Electronic"),("techno","Electronic"),("trance","Electronic"),("classical","Classical"),("orchestra","Classical"),("opera","Classical"),("folk","Folk"),("acoustic","Folk"),("singer-songwriter","Folk"),("reggae","Reggae"),("ska","Reggae"),("dancehall","Reggae"),("soundtrack","Soundtrack"),("score","Soundtrack"),("musical","Soundtrack"),("latin","Latin"),("salsa","Latin"),("reggaeton","Latin"),("gospel","Gospel"),("christian","Gospel"),("worship","Gospel"),("world","World"),("afro","World"),("celtic","World"),("pop","Pop"),("rock","Rock"))

def _canonicalize_genre(tag:str)->str|None:
    g=" ".join(str(tag or "").lower().replace("_"," ").split())
    if not g or not any(c.isalpha() for c in g): return None
    for needle,bucket in _GENRE_RULES:
        if needle in g: return bucket
    return None

def _parse_genre_rows(sub:dict[str,Any])->list[dict[str,Any]]:
    rows=sub.get("genres",{}).get("genre") or []
    if isinstance(rows,dict): rows=[rows]
    out=[]
    for g in rows:
        if isinstance(g,str):
            if g.strip(): out.append({"value":g.strip(),"albumCount":0,"songCount":0})
        else:
            value=str(g.get("value") or g.get("name") or "").strip()
            if value: out.append({"value":value,"albumCount":int(g.get("albumCount") or 0),"songCount":int(g.get("songCount") or 0)})
    return out

def _genre_buckets(raw_rows:list[dict[str,Any]])->list[dict[str,Any]]:
    buckets={name:{"value":name,"albumCount":0,"songCount":0,"tags":[]} for name in _CANONICAL_GENRES}
    for row in raw_rows:
        canon=_canonicalize_genre(row["value"])
        if not canon or canon not in buckets: continue
        b=buckets[canon]; value=row["value"]
        if value not in b["tags"]: b["tags"].append(value)
        b["albumCount"]+=int(row.get("albumCount") or 0); b["songCount"]+=int(row.get("songCount") or 0)
    return [buckets[name] for name in _CANONICAL_GENRES if buckets[name]["tags"]]

async def _albums_for_genre_tags(tags:list[str],size:int)->list[dict[str,Any]]:
    seen=set(); collected=[]; use_tags=tags[:18]; per=max(24,min(80,size*2))
    for tag in use_tags:
        sub=await _nd_get("getAlbumList2.view",{"type":"byGenre","genre":tag,"size":str(per),"offset":"0"}); raw=(sub.get("albumList2") or {}).get("album") or []
        for a in await asyncio.to_thread(_collapse_apply,raw):
            aid=a.get("id")
            if aid and aid not in seen: seen.add(aid); collected.append(a)
            if len(collected)>=size: return collected
    return collected

@app.get("/api/albums")
async def albums(list_type:str=Query("newest",alias="type"),size:int=Query(40,ge=1,le=200),offset:int=Query(0,ge=0),letter:str|None=Query(None,min_length=1,max_length=2),genre:str|None=Query(None,min_length=1,max_length=80),sort:str=Query("artist",pattern="^(artist|album)$")):
    if list_type=="alphabeticalByName" and letter:
        ch=letter.upper(); rows,total,mode=await _letter_rail(ch,size,offset,sort); return {"albums":rows,"type":list_type,"letter":letter,"genre":genre,"sort":sort,"total":total,"offset":offset,"size":size,"hasMore":offset+len(rows)<total,"mode":mode}
    if list_type=="byGenre":
        buckets={b["value"]:b for b in await _ensure_genre_buckets()}; tags=list((buckets.get(genre) or {}).get("tags") or [genre]); merged=await _albums_for_genre_tags(tags,size); return {"albums":merged[:size],"type":list_type,"letter":letter,"genre":genre}
    sub=await _nd_get("getAlbumList2.view",{"type":list_type,"offset":str(offset),"size":str(min(500,max(size*4,size)))})
    raw=(sub.get("albumList2") or {}).get("album") or []; merged=await asyncio.to_thread(_collapse_apply,raw); return {"albums":merged[:size],"type":list_type,"letter":letter,"genre":genre}

@app.get("/api/genres")
async def genres(): return {"genres":await _ensure_genre_buckets(),"mode":"canonical"}
@app.get("/api/letters")
async def letters(): return {"letters":await _ensure_available_letters()}

@app.get("/api/album/{album_id:path}")
async def album_detail(album_id:str):
    if album_id.startswith("folder:"):
        fk=resolve_folder_key(album_id)
        if not fk: invalidate_caches(); fk=resolve_folder_key(album_id)
        if not fk: raise HTTPException(404,"Folder pack not found")
        merged=build_folder_album(fk)
        if not merged: raise HTTPException(404,"Folder pack empty")
        return meta.apply_album(merged)
    sub=await _nd_get("getAlbum.view",{"id":album_id}); album=sub.get("album") or {}
    if not album: raise HTTPException(404,"Album not found")
    return _expand_album(album)

@app.get("/api/search")
async def search(q:str=Query(...,min_length=1)):
    sub=await _nd_get("search3.view",{"query":q,"artistCount":10,"albumCount":24,"songCount":24}); result=sub.get("searchResult3") or {}; return {"artists":result.get("artist") or [],"albums":await asyncio.to_thread(_collapse_apply,result.get("album") or []),"songs":meta.apply_song_list(result.get("song") or [])}

@app.get("/api/locate/{song_id}")
async def locate(song_id:str):
    fallback=None; song={}
    try: sub=await _nd_get("getSong.view",{"id":song_id}); song=sub.get("song") or {}; fallback=song.get("path")
    except HTTPException: pass
    info=await asyncio.to_thread(locate_song,song_id,fallback)
    if not info.get("found"): raise HTTPException(404,"Track path not found in Cindy index")
    return info

@app.get("/api/locate-album/{album_id:path}")
async def locate_album_api(album_id:str):
    info=await asyncio.to_thread(locate_album,album_id)
    if not info.get("found"): raise HTTPException(404,"Album path not found in Cindy index")
    return info

@app.post("/api/meta/album")
async def meta_album(body:AlbumMetaPatch): return {"ok":True,"id":body.id,"override":meta.patch_album(body.id,{"name":body.name,"artist":body.artist}),"note":"Vinyl display only — Cindy files unchanged"}
@app.post("/api/meta/song")
async def meta_song(body:SongMetaPatch): return {"ok":True,"id":body.id,"override":meta.patch_song(body.id,{"title":body.title,"artist":body.artist,"album":body.album}),"note":"Vinyl display only — Cindy files unchanged"}

_MAX_COVER_BYTES=8*1024*1024
@app.post("/api/meta/cover/{album_id}/upload")
async def upload_album_cover(album_id:str,file:UploadFile=File(...)):
    content=await file.read()
    if not content or len(content)>_MAX_COVER_BYTES: raise HTTPException(400,"bad image")
    ctype=file.content_type or "image/jpeg"; cover_id=meta.set_album_cover(album_id,content,ctype); return {"ok":True,"id":album_id,"coverArt":cover_id}
@app.post("/api/meta/cover/{album_id}/from-url")
async def set_album_cover_from_url(album_id:str,body:CoverFromUrl):
    client=await _http_client(); r=await client.get(body.url,timeout=15,follow_redirects=True)
    if r.status_code>=400 or not r.content: raise HTTPException(400,"could not fetch that image")
    ctype=r.headers.get("content-type","image/jpeg").split(";")[0].strip(); cover_id=meta.set_album_cover(album_id,r.content,ctype); return {"ok":True,"id":album_id,"coverArt":cover_id}
@app.delete("/api/meta/cover/{album_id}")
async def remove_album_cover(album_id:str): meta.clear_album_cover(album_id); return {"ok":True,"id":album_id}

@app.get("/api/coversearch")
async def cover_search(q:str=Query(...,min_length=1)):
    client=await _http_client(); r=await client.get("https://itunes.apple.com/search",params={"term":q,"media":"music","entity":"album","limit":12},timeout=10); results=[]
    for item in r.json().get("results",[]):
        art=item.get("artworkUrl100")
        if art: results.append({"collectionName":item.get("collectionName"),"artistName":item.get("artistName"),"thumbUrl":art,"artworkUrl":art.replace("100x100bb","600x600bb")})
    return {"results":results}

@app.get("/api/playlist")
async def get_playlist(): return {"tracks":playlist_store.get_playlist()}
@app.post("/api/playlist/add")
async def add_to_playlist(body:PlaylistAdd): return {"ok":True,"tracks":playlist_store.add_track(body.model_dump())}
@app.post("/api/playlist/add-many")
async def add_many_to_playlist(body:PlaylistAddMany): return {"ok":True,"tracks":playlist_store.add_tracks([t.model_dump() for t in body.tracks])}
@app.delete("/api/playlist/{song_id}")
async def remove_from_playlist(song_id:str): return {"ok":True,"tracks":playlist_store.remove_track(song_id)}
@app.delete("/api/playlist")
async def clear_playlist(): playlist_store.clear_playlist(); return {"ok":True,"tracks":[]}
@app.post("/api/refresh-packs")
async def refresh_packs(): invalidate_caches(); _letter_full_cache.clear(); return {"ok":True}

@app.get("/api/cover/{cover_id}")
async def cover(cover_id:str,size:int=Query(600,ge=40,le=1200)):
    params=_auth_params(); params.update({"id":cover_id,"size":str(size)}); client=await _http_client(); r=await client.get(f"{NAVIDROME}/rest/getCoverArt.view?{urlencode(params)}")
    if r.status_code>=400: raise HTTPException(r.status_code,"cover missing")
    return Response(content=r.content,media_type=r.headers.get("content-type","image/jpeg"),headers={"Cache-Control":"public, max-age=604800, immutable"})

@app.get("/api/stream/{song_id}")
async def stream(song_id:str,request:Request):
    params=_auth_params(); params["id"]=song_id; headers={}
    if range_h:=request.headers.get("range"): headers["Range"]=range_h
    client=httpx.AsyncClient(timeout=None); req=client.build_request("GET",f"{NAVIDROME}/rest/stream.view?{urlencode(params)}",headers=headers); r=await client.send(req,stream=True)
    if r.status_code>=400: await r.aclose(); await client.aclose(); raise HTTPException(r.status_code,"stream failed")
    # A missing file comes back as a short JSON/text body. Hand that to the
    # player as an HTTP error. Streaming it as audio makes WebView2 wait forever.
    ctype=(r.headers.get("content-type") or "").split(";")[0].strip().lower()
    if ctype in ("application/json","text/plain","text/html") or ctype.startswith("text/"):
        await r.aread(); await r.aclose(); await client.aclose()
        raise HTTPException(404,"track file is not on the shelf")
    # httpx already decoded Content-Encoding, so the upstream Content-Length is
    # the compressed size. Forwarding it makes uvicorn abort
    # ("Response content longer than Content-Length") and the desktop window
    # stops responding while the audio element waits for bytes that never come.
    passthrough=("content-type","content-range","accept-ranges")
    out_headers={h:r.headers[h] for h in passthrough if h in r.headers}
    if "content-encoding" not in r.headers and "content-length" in r.headers:
        out_headers["content-length"]=r.headers["content-length"]
    async def body():
        try:
            async for chunk in r.aiter_bytes(): yield chunk
        finally: await r.aclose(); await client.aclose()
    return StreamingResponse(body(),status_code=r.status_code,headers=out_headers,media_type=r.headers.get("content-type"))


def _asset_ver(name:str)->str:
    try: data=(STATIC/name).read_bytes()
    except OSError: return "0"
    return hashlib.md5(data).hexdigest()[:10]

@app.get("/")
async def index():
    index_path=STATIC/"index.html"
    if not index_path.exists(): raise HTTPException(404,"UI missing")
    html=index_path.read_text(encoding="utf-8").replace("__APP_JS_VER__",_asset_ver("app.js")).replace("__STYLE_CSS_VER__",_asset_ver("style.css")); return HTMLResponse(html,headers={"Cache-Control":"no-cache"})

def _pwa_file(name:str,media_type:str)->FileResponse:
    path=STATIC/name
    if not path.is_file(): raise HTTPException(404,f"{name} missing")
    return FileResponse(path,media_type=media_type)
@app.get("/manifest.json")
async def manifest(): return _pwa_file("manifest.json","application/manifest+json")
@app.get("/sw.js")
async def service_worker(): return _pwa_file("sw.js","application/javascript; charset=utf-8")
@app.get("/icon-192.png")
async def icon_192(): return _pwa_file("icon-192.png","image/png")
@app.get("/icon-512.png")
async def icon_512(): return _pwa_file("icon-512.png","image/png")
@app.get("/apple-touch-icon.png")
async def apple_touch_icon(): return _pwa_file("apple-touch-icon.png","image/png")
@app.get("/cindy-vinyl-icon.svg")
async def cindy_icon_svg(): return _pwa_file("cindy-vinyl-icon.svg","image/svg+xml")

if STATIC.exists(): app.mount("/static",StaticFiles(directory=str(STATIC)),name="static")
