import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const WORKDIR = "/tmp/pi-score";

function run(cmd: string, args: string[], timeoutMs: number): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args);
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr });
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ code: 127, stdout, stderr: String(err) });
    });
  });
}

function prepSource(source: string, title?: string): string {
  if (!source.includes("\\version")) source = '\\version "2.24.0"\n' + source;
  if (title && !source.includes("\\header")) {
    source = source.replace(/(\\version[^\n]*\n)/, `$1\\header { title = "${title}" }\n`);
  }
  return source;
}

// Add a \\midi block so lilypond also emits the .midi file.
function ensureMidi(source: string): string {
  if (/\\midi/.test(source)) return source;
  const m = source.match(/\\score\b/);
  if (!m) return `\\score { ${source} \\midi { } }`;
  // Insert \\midi before the closing brace of the first \\score (brace counting)
  const start = source.indexOf("{", m.index!);
  let depth = 0;
  for (let i = start; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") {
      depth--;
      if (depth === 0) return source.slice(0, i) + "\\midi { } " + source.slice(i);
    }
  }
  return source;
}

async function findSoundFont(): Promise<string | null> {
  const dirs = (process.env.XDG_DATA_DIRS ?? "/usr/local/share:/usr/share").split(":");
  const { stdout } = await run("find", [...dirs.map((d) => d + "/soundfonts"), "-iname", "*.sf2"], 10000);
  return stdout.split("\n").find((l) => l.trim()) ?? null;
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "render_score",
    label: "Render a score",
    description:
      "Compiles a complete LilyPond file into a PNG score displayed inline in the chat. " +
      "Use it to show the student ANY musical notation (exercise, example, correction). " +
      "The file must be a complete .ly with \\version and a \\relative or \\score (see the template in the music-teacher skill). " +
      "On error the compiler message is returned: fix and retry until the score displays.",
    parameters: Type.Object({
      source: Type.String({ description: "Full content of a LilyPond (.ly) file" }),
      title: Type.Optional(Type.String({ description: "Title displayed above the score (optional)" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      await mkdir(WORKDIR, { recursive: true });

      let source = params.source;
      if (!source.includes("\\version")) source = '\\version "2.24.0"\n' + source;
      // Bigger staves for on-screen readability (unless the source sets its own)
      if (!/staff-size|set-global-staff-size/.test(source)) {
        source = source.replace(/(\\version[^\n]*\n)/, `$1#(set-global-staff-size 26)\n`);
      }
      if (params.title && !source.includes("\\header")) {
        source = source.replace(/(\\version[^\n]*\n)/, `$1\\header { title = "${params.title}" }\n`);
      }

      const ly = join(WORKDIR, "score.ly");
      const out = join(WORKDIR, "score");
      await writeFile(ly, source);

      // -dpreview generates score.preview.png: tight crop of the 1st system, readable on screen
      const { code, stderr } = await run(
        "lilypond",
        ["--png", "-dresolution=200", "-dpreview", "-o", out, ly],
        30000,
      );

      if (code !== 0) {
        const missing = code === 127 && stderr.includes("ENOENT");
        return {
          content: [
            {
              type: "text",
              text: missing
                ? "lilypond is not installed or not on PATH. Quick test: `nix-shell -p lilypond --run pi`. Permanent install: add `pkgs.lilypond` to home.packages then `nixos-rebuild switch`."
                : `LilyPond compilation failed (code ${code}).\n${stderr}`,
            },
          ],
          details: { ok: false, ly },
        };
      }

      // Display: preview (1st system, cropped); fallback: full page.
      const png = await readFile(join(WORKDIR, "score.preview.png")).catch(() =>
        readFile(join(WORKDIR, "score.png")).catch(() => readFile(join(WORKDIR, "score-1.png"))),
      );
      const hasMorePages = (await readFile(join(WORKDIR, "score-2.png")).catch(() => null)) !== null;

      return {
        content: [
          {
            type: "text",
            text: `Score rendered (1st system)${hasMorePages ? " — the piece is longer than one page" : ""} — source: ${ly}`,
          },
          { type: "image", data: png.toString("base64"), mimeType: "image/png" },
        ],
        details: { ok: true, ly },
      };
    },
  });

  pi.registerTool({
    name: "play_score",
    label: "Play a score (audio)",
    description:
      "Compiles a complete LilyPond file and plays it as audio (MIDI → fluidsynth → WAV → paplay). " +
      "The same .ly as render_score works: a \\midi block is added automatically when missing. " +
      "Sound comes out of the machine's speakers. Returns a readable error on failure.",
    parameters: Type.Object({
      source: Type.String({ description: "Full content of a LilyPond (.ly) file" }),
      title: Type.Optional(Type.String({ description: "Title (optional)" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      await mkdir(WORKDIR, { recursive: true });

      const source = ensureMidi(prepSource(params.source, params.title));
      const ly = join(WORKDIR, "audio.ly");
      const out = join(WORKDIR, "audio");
      await writeFile(ly, source);

      // -dno-print-pages: no PDF, only the .midi
      const { code, stderr } = await run("lilypond", ["-dno-print-pages", "-o", out, ly], 30000);
      if (code !== 0) {
        const missing = code === 127 && stderr.includes("ENOENT");
        return {
          content: [
            {
              type: "text",
              text: missing
                ? "lilypond is not installed — run pi via `nix develop` in this project."
                : `MIDI compilation failed (code ${code}).\n${stderr}`,
            },
          ],
          details: { ok: false, ly },
        };
      }

      const midi = out + ".midi";
      const sf = await findSoundFont();
      if (!sf) {
        return {
          content: [{ type: "text", text: "No SoundFont found — make sure soundfont-fluid is in the dev shell." }],
          details: { ok: false },
        };
      }

      const wav = out + ".wav";
      const res = await run("fluidsynth", ["-ni", "-F", wav, sf, midi], 60000);
      if (res.code !== 0) {
        return { content: [{ type: "text", text: `fluidsynth failed.\n${res.stderr}` }], details: { ok: false } };
      }

      // Play in the background: paplay (Pulse/PipeWire), aplay (ALSA) as fallback.
      const player = (await run("bash", ["-lc", "command -v paplay || command -v aplay"], 5000)).stdout.trim();
      if (!player) {
        return { content: [{ type: "text", text: "No audio player (paplay/aplay) on PATH." }], details: { ok: false } };
      }
      spawn(player, [wav], { detached: true, stdio: "ignore" }).unref();

      return {
        content: [{ type: "text", text: `🎵 Audio playing in the background (fluidsynth → ${player}) — source: ${ly}` }],
        details: { ok: true, ly },
      };
    },
  });
}
