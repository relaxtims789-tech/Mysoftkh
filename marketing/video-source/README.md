# Guide videos - source

The two guide videos in `../videos/` are built from real screenshots of the system (in `v1/`, `v2/`) with captions in
Khmer and English. Nothing here is needed to run the system.

- `video/scenes.js` - every scene: screenshot, caption (`km`, `en`), how long it shows (`dur`, seconds), where the pointer
  taps (`target`) and how far it zooms (`zoom`). Edit the captions or timing here.
- `video/compose.html` - the layout of one scene (browser window / phone frame, caption band, title and end cards).
- `video/player.html` - plays the scenes (crossfade, zoom, pointer, progress bar) and records an H.264 MP4 in Chrome.
- `video/render.mjs` - runs it all with Google Chrome:

```bash
cd video
node render.mjs v1 frames
node render.mjs v1 record ../../videos
```

Use `v2` for the staff-app video. `node render.mjs v1 preview . 5,20,40` saves still frames to check before recording.
Recording runs in real time (about 80 seconds for video 1).

`cap.mjs` took the screenshots from a local copy of the system (`node cap.mjs steps.json v1`); only needed to retake them.

## Promotion video (Khmer script, vertical)

`video/promo.html` lays out the scenes of `VIDEOS.promo` in `video/scenes.js` (the customer's script, word for word).
To add a presenter (talking head in the round frame at the top right, her voice as the soundtrack), put the clip in this
folder, e.g. `presenter.mp4`, then:

```bash
cd video
node render.mjs promo frames
PRESENTER=../presenter.mp4 node render.mjs promo record ../../videos
```

Use a relative path for PRESENTER (Git Bash rewrites paths that start with "/"). Adjust each scene's `dur` to the
presenter's timing. The presenter script with times is `../videos/Promo-Presenter-Script.txt`.
