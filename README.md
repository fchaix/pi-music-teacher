# pi music teacher

Use [pi](https://github.com/earendil-works/pi) (a coding agent) as a **music teacher**: every musical example is written as text in LilyPond — the "LaTeX of music" — and **compiled into a visible score** rendered inline in the chat. The same source can also be **played as audio**.

```
you:  Show me a C major scale
agent: [render_score → 🎼 score appears inline]

you:  Play it
agent: [play_score → 🎵 audio through the speakers]
```

## How it works

| Piece | Role |
|---|---|
| `extensions/score-tools.ts` | pi extension exposing two tools: `render_score` (LilyPond `.ly` → PNG, displayed inline) and `play_score` (`.ly` → MIDI → fluidsynth → WAV → plays on the machine) |
| `skills/music-teacher/SKILL.md` | teaching skill: templates, correction loop, note-name mapping — tells the agent *how* to teach and when to render |
| `flake.nix` | Nix dev shell providing `lilypond`, `fluidsynth`, a SoundFont, and audio players |
| `.pi/settings.json` | terminal image width for readable scores + loads this repo as a package |

Everything is plain text in, score + sound out — no proprietary format, no editor lock-in.

## Install as a pi package

This repo *is* a [pi package](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/packages.md) (`pi-package` keyword, `pi` manifest in `package.json`). Install it with pi:

```bash
pi install git:github.com/fchaix/pi-music-teacher   # from git
pi install npm:pi-music-teacher                    # from npm (once published)
pi install /path/to/pi-music-teacher               # local path
```

Publishing to npm requires Node/npm: `npm publish` (after `npm login`), or `npm pack` to inspect the tarball first. The package only ships `extensions/`, `skills/`, `README.md` and `LICENSE`.

## Requirements

- **Terminal with inline image support** (Kitty, iTerm2, Ghostty, WezTerm, Warp) for the score rendering.
- **Nix** with flakes enabled for the dev shell.
- **pi** (the coding agent).

## Install & usage

```bash
cd music-course
nix develop          # brings lilypond, fluidsynth, soundfont, paplay
pi                   # trust the project; .pi/settings.json loads this repo as a package
```

Then in pi, ask anything musical. Examples:

- *"Show me a D minor scale"*
- *"An exercise in 3/4 with I–IV–V"*
- *"Play the exercise so I can hear it"*

The agent calls `render_score` (and `play_score` when audio is wanted); a complete `.ly` is compiled and the score appears right in the chat. On a LilyPond error, the compiler message is returned and the agent self-corrects.

## Tools

### `render_score`
Takes a complete LilyPond `.ly` source (+ optional title), compiles it with
`lilypond --png -dresolution=200 -dpreview`, and returns the PNG as an inline image.
The render is cropped to the **1st system** for terminal readability; pieces longer
than one page report that only the first page is shown. `\version` and `\header`
are added automatically when missing, and `#(set-global-staff-size 26)` enlarges
the staves for on-screen reading unless the source sets its own.

### `fetch_score`
Takes a Mutopia piece path (e.g. `BachJS/BWV1001/bwv-1001_1`) or any `.ly` URL, downloads it,
checks the license (only PD/CC0/CC-BY/CC-BY-SA are rendered; NC/ND refused), converts old `\version`
syntax with `convert-ly` (headless `pi` sub-agent as last resort), and renders the whole piece
inline with full attribution (composer, typesetter, license, source).

### `play_score`
Takes the same `.ly` source, adds a `\midi` block automatically when missing,
compiles to MIDI, renders a WAV with fluidsynth (FluidR3 SoundFont found via
`XDG_DATA_DIRS`), and plays it in the background via `paplay` (PulseAudio/PipeWire),
falling back to `aplay` (ALSA). Audio plays on the machine the agent runs on.

## Branches

- `main` — everything in English.
- `fr` — the `music-teacher` skill in French (the author's own teaching material:
  French note names *do ré mi…*, pedagogy in French). Code and README stay in English.

## License

GPL-3.0 (strong copyleft) — see [LICENSE](LICENSE).
