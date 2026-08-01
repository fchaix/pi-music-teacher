// pi music teacher — score-tools.ts
//
// Copyright (C) 2026 fchaix
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// SPDX-License-Identifier: GPL-3.0-or-later

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

const MUTOPIA_BASE = "https://raw.githubusercontent.com/MutopiaProject/MutopiaProject/master/ftp/";
const MUTOPIA_API = "https://api.github.com/repos/MutopiaProject/MutopiaProject/contents/ftp/";

// Resolve a Mutopia piece path (or direct .ly URL) to its .ly content.
async function resolveLy(source: string): Promise<{ url: string; text: string } | { error: string }> {
  if (/^https?:\/\//.test(source)) {
    const resp = await fetch(source);
    if (!resp.ok) return { error: `HTTP ${resp.status} while fetching ${source}` };
    return { url: source, text: await resp.text() };
  }
  const path = source.replace(/^\//, "");
  // Try the raw file directly (works when the path already ends in .ly).
  let resp = await fetch(MUTOPIA_BASE + path);
  if (resp.ok) return { url: MUTOPIA_BASE + path, text: await resp.text() };
  // Otherwise it's a piece directory: list it via the GitHub API and pick the .ly file.
  const apiResp = await fetch(MUTOPIA_API + path, { headers: { "User-Agent": "pi-music-teacher" } });
  if (!apiResp.ok) {
    return { error: `HTTP ${apiResp.status} — neither file nor directory found at ${path}` };
  }
  const entries = (await apiResp.json()) as { name: string; download_url: string | null }[];
  const ly = entries.find((e) => e.name.endsWith(".ly"));
  if (!ly?.download_url) {
    return { error: `No .ly file in ${path} (found: ${entries.map((e) => e.name).join(", ")})` };
  }
  resp = await fetch(ly.download_url);
  if (!resp.ok) return { error: `HTTP ${resp.status} while fetching ${ly.download_url}` };
  return { url: ly.download_url, text: await resp.text() };
}

function parseHeader(ly: string): Record<string, string> {
  const out: Record<string, string> = {};
  const h = ly.match(/\\header\s*{([\s\S]*?)}/);
  if (!h) return out;
  for (const m of h[1].matchAll(/([a-zA-Z]+)\s*=\s*"((?:[^"\\]|\\.)*)"/g)) {
    out[m[1]] = m[2];
  }
  return out;
}

// Licence policy: only reuse works we are allowed to modify, perform and
// redistribute (the tool converts and re-typesets them).
function checkLicense(copyright: string | undefined): { ok: boolean; reason: string } {
  const s = (copyright ?? "").toLowerCase();
  if (!s) return { ok: false, reason: "No license field in the header" };
  if (/all rights reserved/.test(s)) return { ok: false, reason: `All rights reserved: ${copyright}` };
  if (/\bnc\b|non-?commercial/.test(s)) return { ok: false, reason: `Non-commercial (NC) license not reusable here: ${copyright}` };
  if (/\bnd\b|no-?derivative/.test(s)) return { ok: false, reason: `No-derivatives (ND) license not reusable here: ${copyright}` };
  if (/public domain|cc0|creative commons|attribution|gpl/.test(s)) return { ok: true, reason: copyright! };
  return { ok: false, reason: `Unknown license: ${copyright}` };
}

function versionOf(ly: string): [number, number] {
  const m = ly.match(/\\version\s+"(\d+)\.(\d+)/);
  return m ? [parseInt(m[1]), parseInt(m[2])] : [0, 0];
}

// Mutopia declares the instrument in \header.mutopiainstrument (German names).
const INSTRUMENT_KEYWORDS: [RegExp, string][] = [
  [/violine|violin/, "violin"],
  [/violoncello|\bcello\b/, "cello"],
  [/\bviola\b/, "viola"],
  [/kontrabass|contrabass|double ?bass/, "contrabass"],
  [/blockfl[oö]te|recorder/, "recorder"],
  [/fl[oö]te|flute/, "flute"],
  [/oboe/, "oboe"],
  [/klarinette|clarinet/, "clarinet"],
  [/fagott|bassoon/, "bassoon"],
  [/horn/, "french horn"],
  [/trompete|trumpet/, "trumpet"],
  [/posaune|trombone/, "trombone"],
  [/tuba/, "tuba"],
  [/gitarre|guitar/, "acoustic guitar (nylon)"],
  [/harfe|harp/, "orchestral harp"],
  [/orgel|organ/, "church organ"],
  [/saxophon|saxophone/, "alto sax"],
  [/klavier|piano/, "acoustic grand"],
];

function mapInstrument(mutopiaInstrument: string | undefined): string | null {
  if (!mutopiaInstrument) return null;
  const s = mutopiaInstrument.toLowerCase();
  for (const [re, name] of INSTRUMENT_KEYWORDS) {
    if (re.test(s)) return name;
  }
  return null;
}

// Set the MIDI instrument inside the \midi block without touching the music.
// Note: in \midi \context blocks, properties are bare assignments (no backslash).
function withMidiInstrument(text: string, inst: string): string {
  if (!/\\midi\s*\{/.test(text)) return text;
  return text.replace(/\\midi\s*\{[^}]*\}/, (m) => {
    const inner = m.slice(m.indexOf("{") + 1, m.lastIndexOf("}"));
    return `\\midi { ${inner} \\context { \\Staff midiInstrument = "${inst}" } }`;
  });
}

async function compileToPng(out: string): Promise<{ code: number; stderr: string }> {
  return run("lilypond", ["--png", "-dresolution=200", "-o", out, out + ".ly"], 60000);
}

async function pngPages(out: string): Promise<Buffer[]> {
  const pages: Buffer[] = [];
  // lilypond 2.26 names: out.png (single page) or out-page1.png, out-page2.png…
  const first = await readFile(out + ".png")
    .catch(() => readFile(out + "-page1.png"))
    .catch(() => null);
  if (first) pages.push(first);
  for (let i = 2; i <= 20; i++) {
    const p = await readFile(`${out}-page${i}.png`).catch(() => null);
    if (p) pages.push(p);
    else break;
  }
  return pages;
}

// PNG width is stored big-endian at bytes 16-20 (IHDR).
function pngWidth(buf: Buffer): number {
  return buf.readUInt32BE(16);
}

const ONE_LINE_MAX_WIDTH = 12000; // px at 200dpi; beyond that a strip is unreadable

// Short pieces: one wide strip (whole piece). Long pieces: default page
// breaking, one image per page — both readable in the terminal.
async function renderAuto(
  lyPath: string,
  out: string,
): Promise<{ images: Buffer[]; mode: "strip" | "pages"; code: number; stderr: string }> {
  let { code, stderr } = await compileToPng(out);
  if (code !== 0) return { images: [], mode: "strip", code, stderr };

  let images = await pngPages(out);
  if (images.length && pngWidth(images[0]) > ONE_LINE_MAX_WIDTH) {
    const src = await readFile(lyPath, "utf8").catch(() => "");
    const srcPages = src.replace(
      /\\paper\s*\{[^}]*one-line-auto-height-breaking[^}]*\}/,
      "",
    );
    const outPages = out + "-pages";
    await writeFile(outPages + ".ly", srcPages);
    const r2 = await compileToPng(outPages);
    if (r2.code === 0) images = await pngPages(outPages);
    return { images, mode: "pages", code: r2.code, stderr: r2.stderr };
  }
  return { images, mode: "strip", code, stderr };
}

function stripFences(s: string): string {
  return s.replace(/```[^\n]*\n?/g, "").replace(/```/g, "").trim();
}

// Last-resort fallback: hand the broken .ly to a headless pi sub-agent.
async function fixWithSubAgent(source: string, errors: string): Promise<string | null> {
  const prompt =
    "You are fixing a LilyPond (.ly) file that fails to compile with lilypond 2.26.\n" +
    "Fix ALL syntax errors and return ONLY the complete corrected .ly file content, " +
    "no explanations, no markdown fences.\n\n" +
    "--- FILE ---\n" +
    source +
    "\n--- COMPILER ERRORS ---\n" +
    errors;
  const res = await run("pi", ["--mode", "json", "--no-session", "-p", prompt], 180000);
  if (res.code !== 0) return null;
  const last = res.stdout
    .split("\n")
    .filter((l) => l.includes('"type":"message_end"'))
    .pop();
  if (!last) return null;
  try {
    const ev = JSON.parse(last);
    const content = ev?.message?.content;
    if (typeof content === "string") return stripFences(content);
    if (Array.isArray(content)) return stripFences(content.map((b: any) => b?.text ?? "").join("\n"));
  } catch {
    /* not JSON */
  }
  return null;
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
      // One line per page: the whole piece fits a single wide strip (nothing truncated)
      if (!/page-breaking|one-line/.test(source)) {
        source = source.replace(
          /(\\version[^\n]*\n)/,
          `$1\\paper { page-breaking = #ly:one-line-auto-height-breaking }\n`,
        );
      }
      if (params.title && !source.includes("\\header")) {
        source = source.replace(/(\\version[^\n]*\n)/, `$1\\header { title = "${params.title}" }\n`);
      }

      const ly = join(WORKDIR, "score.ly");
      const out = join(WORKDIR, "score");
      await writeFile(ly, source);

      const { code, stderr, images, mode } = await renderAuto(ly, out);

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

      if (!images.length) {
        return {
          content: [{ type: "text", text: "Compilation OK but no PNG image was produced." }],
          details: { ok: false, ly },
        };
      }

      const label = mode === "strip" ? "whole piece" : `${images.length} pages`;
      return {
        content: [
          {
            type: "text",
            text: `Score rendered (${label}) — source: ${ly}`,
          },
          ...images.map((png) => ({ type: "image" as const, data: png.toString("base64"), mimeType: "image/png" })),
        ],
        details: { ok: true, ly, pages: images.length },
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

  pi.registerTool({
    name: "fetch_score",
    label: "Fetch and render a score from Mutopia",
    description:
      "Downloads a LilyPond score from the Mutopia Project (free, public-domain/CC sheet music), " +
      "checks the piece's license, converts it to a current LilyPond version if needed, and renders it inline. " +
      "Only license-compatible pieces are rendered (PD/CC0/CC-BY/CC-BY-SA; NC and ND are refused). " +
      "Attribution (composer + typesetter + license) is always shown.",
    parameters: Type.Object({
      source: Type.String({
        description:
          "Mutopia piece path (e.g. 'BachJS/BWV1001/bwv-1001_1') or any direct URL to a .ly file",
      }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      await mkdir(WORKDIR, { recursive: true });

      const resolved = await resolveLy(params.source);
      if ("error" in resolved) {
        return {
          content: [{ type: "text", text: resolved.error }],
          details: { ok: false },
        };
      }
      let text = resolved.text;
      const url = resolved.url;

      const ly = join(WORKDIR, "fetched.ly");
      await writeFile(ly, text);

      const header = parseHeader(text);
      const license = checkLicense(header["copyright"]);
      const inst = mapInstrument(header["mutopiainstrument"]);
      const attribution =
        `Piece: ${header["title"] ?? "?"} — ${header["composer"] ?? "?"}\n` +
        `Typeset by: ${header["maintainer"] ?? "?"}\n` +
        `License: ${header["copyright"] ?? "?"}\n` +
        `Instrument: ${header["mutopiainstrument"] ?? "?"} → ${inst ?? "piano (default)"}\n` +
        `Source: ${url}`;

      if (!license.ok) {
        return {
          content: [
            {
              type: "text",
              text:
                `🚫 Not rendered — license not reusable in this tool.\n${attribution}\nReason: ${license.reason}`,
            },
          ],
          details: { ok: false, ly, license: license.reason },
        };
      }

      // Convert old \version syntax to the current LilyPond, if needed.
      const current = [2, 26];
      if (versionOf(text)[0] < current[0] || (versionOf(text)[0] === current[0] && versionOf(text)[1] < current[1])) {
        const conv = await run("convert-ly", ["-e", ly], 30000);
        if (conv.code !== 0) {
          return {
            content: [{ type: "text", text: `convert-ly failed.\n${conv.stderr}` }],
            details: { ok: false, ly },
          };
        }
        text = await readFile(ly, "utf8");
      }

      // Map the declared instrument to MIDI (piano default otherwise).
      if (inst) text = withMidiInstrument(text, inst);

      // One line per page: whole piece on a single strip (unless the source sets its own).
      if (!/page-breaking|one-line/.test(text)) {
        await writeFile(ly, text.replace(/(\\version[^\n]*\n)/, `$1\\paper { page-breaking = #ly:one-line-auto-height-breaking }\n`));
      }

      const out = join(WORKDIR, "fetched");
      let { code, stderr, images, mode } = await renderAuto(ly, out);
      if (code !== 0) {
        // Last resort: ask a headless pi sub-agent to fix the file.
        const fixed = await fixWithSubAgent(text, stderr);
        if (fixed) {
          await writeFile(ly, fixed);
          ({ code, stderr, images, mode } = await renderAuto(ly, out));
        }
      }
      if (code !== 0) {
        return {
          content: [
            {
              type: "text",
              text: `Compilation failed (code ${code}) — the piece may need manual conversion.\n${attribution}\n${stderr}`,
            },
          ],
          details: { ok: false, ly, license: license.reason },
        };
      }

      if (!images.length) {
        return {
          content: [{ type: "text", text: `Compilation OK but no PNG image was produced.\n${attribution}` }],
          details: { ok: false, ly, license: license.reason },
        };
      }

      const label = mode === "strip" ? "whole piece on one line" : `${images.length} pages`;
      return {
        content: [
          { type: "text", text: `${attribution}\n✅ Rendered (${label}) — license compatible.` },
          ...images.map((png) => ({ type: "image" as const, data: png.toString("base64"), mimeType: "image/png" })),
        ],
        details: { ok: true, ly, license: license.reason, title: header["title"], pages: images.length },
      };
    },
  });
}
