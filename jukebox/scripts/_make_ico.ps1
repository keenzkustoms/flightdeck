Add-Type -AssemblyName System.Drawing
$src = Join-Path $PSScriptRoot "..\static\icon-512.png"
$dst = Join-Path $PSScriptRoot "..\static\cindy-vinyl.ico"
$img = [System.Drawing.Image]::FromFile($src)
$sizes = @(16, 32, 48, 256)
$bitmaps = @()
foreach ($s in $sizes) {
  $bmp = New-Object System.Drawing.Bitmap $s, $s
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.Clear([System.Drawing.Color]::Transparent)
  $g.DrawImage($img, 0, 0, $s, $s)
  $g.Dispose()
  $bitmaps += $bmp
}
$fs = [System.IO.File]::Open($dst, [System.IO.FileMode]::Create)
$bw = New-Object System.IO.BinaryWriter $fs
$bw.Write([uint16]0)
$bw.Write([uint16]1)
$bw.Write([uint16]$bitmaps.Count)
$streams = @()
foreach ($bmp in $bitmaps) {
  $png = New-Object System.IO.MemoryStream
  $bmp.Save($png, [System.Drawing.Imaging.ImageFormat]::Png)
  $streams += $png
}
$offset = 6 + (16 * $bitmaps.Count)
$off = $offset
for ($i = 0; $i -lt $bitmaps.Count; $i++) {
  $s = $bitmaps[$i].Width
  $bw.Write([byte]$(if ($s -ge 256) { 0 } else { $s }))
  $bw.Write([byte]$(if ($s -ge 256) { 0 } else { $s }))
  $bw.Write([byte]0)
  $bw.Write([byte]0)
  $bw.Write([uint16]1)
  $bw.Write([uint16]32)
  $bw.Write([uint32]$streams[$i].Length)
  $bw.Write([uint32]$off)
  $off += $streams[$i].Length
}
foreach ($png in $streams) {
  $bw.Write($png.ToArray())
  $png.Dispose()
}
$bw.Flush()
$fs.Close()
foreach ($bmp in $bitmaps) { $bmp.Dispose() }
$img.Dispose()
Write-Host "Wrote $dst ($((Get-Item $dst).Length) bytes)"
