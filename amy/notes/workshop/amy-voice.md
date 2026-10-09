# Amy finish window

The microphone finish window is **1400 milliseconds** (`FINISH_MS`). Speech recognition finalizes phrases on pause; Amy buffers and only sends after a true end-of-thought pause.

**Interrupt while she's talking** (mic on, or hit **STOP**): say **stop**, **wait**, **hang on**, **hold on**, **quiet**, or **enough** — she cuts Laura off and keeps listening. Typing stop also works.

**Mute** is the MIC/MUTE toggle — that turns the mic off entirely.

Tune FINISH_MS after a day of real use — too low cuts you off, too high feels sluggish.
