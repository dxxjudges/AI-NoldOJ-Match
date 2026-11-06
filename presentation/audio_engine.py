# -*- coding: utf-8 -*-
"""Narration (piper) + procedural ambient score (numpy) + per-slide mixing."""
from __future__ import annotations

import builtins
import hashlib
import json
import math
import os
import re
import sys
import time
import wave
from pathlib import Path

import numpy as np

# piper_onnx opens its JSON config with the platform default encoding.  On a
# Chinese Windows install that is GBK, so force UTF-8 for text reads.
_orig_open = builtins.open


def _utf8_open(file, mode="r", buffering=-1, encoding=None, *args, **kwargs):
    if "b" not in mode and encoding is None:
        encoding = "utf-8"
    return _orig_open(file, mode, buffering, encoding, *args, **kwargs)


builtins.open = _utf8_open

import espeakng_loader  # noqa: E402
from phonemizer import phonemize  # noqa: E402
from phonemizer.backend.espeak.wrapper import EspeakWrapper  # noqa: E402
from piper_onnx import Piper  # noqa: E402

from script import SLIDES  # noqa: E402

BASE = Path(__file__).resolve().parent
VOICE = BASE / "assets" / "voice" / "zh_CN-huayan-medium.onnx"
VOICE_CFG = BASE / "assets" / "voice" / "zh_CN-huayan-medium.onnx.json"
AUDIO = BASE / "assets" / "audio"
NARR = AUDIO / "narration"
SR = 22050
PRE, POST = 0.45, 1.05
LENGTH_SCALE = 1.15

AUDIO.mkdir(parents=True, exist_ok=True)
NARR.mkdir(parents=True, exist_ok=True)


# ---------------------------------------------------------------------------
# narration
# ---------------------------------------------------------------------------
def _sentences(text: str) -> list[str]:
    text = text.replace("\n", " ").strip()
    raw = re.split(r"(?<=[。！？；!?;])", text)
    chunks = [c.strip() for c in raw if c.strip()]
    merged: list[str] = []
    for c in chunks:
        if merged and len(merged[-1]) < 10:
            merged[-1] = merged[-1] + c
        else:
            merged.append(c)
    # very long sentences: break again at commas, but keep them reasonably sized
    out: list[str] = []
    for c in merged:
        if len(c) <= 64:
            out.append(c)
            continue
        pieces = re.split(r"(?<=[，,：:])", c)
        buf = ""
        for p in pieces:
            if len(buf) + len(p) > 56 and buf:
                out.append(buf)
                buf = p
            else:
                buf += p
        if buf.strip():
            out.append(buf)
    return out


def _trim(x: np.ndarray, thresh=0.006):
    idx = np.where(np.abs(x) > thresh)[0]
    if len(idx) == 0:
        return x
    a = max(0, idx[0] - int(0.02 * SR))
    b = min(len(x), idx[-1] + int(0.04 * SR))
    return x[a:b]


def _fade(x: np.ndarray, ms=12):
    n = max(1, int(ms / 1000 * SR))
    if len(x) < 2 * n:
        return x
    w = np.linspace(0, 1, n, dtype=np.float32)
    x = x.copy()
    x[:n] *= w
    x[-n:] *= w[::-1]
    return x


def _tts_chunk(piper: Piper, s: str) -> np.ndarray:
    ph = phonemize(s, language="cmn", strip=True, preserve_punctuation=True,
                   with_stress=False)
    if not ph or not ph.strip():
        return np.zeros(0, dtype=np.float32)
    samples, sr = piper.create(ph, is_phonemes=True, length_scale=LENGTH_SCALE)
    x = np.asarray(samples, dtype=np.float32).reshape(-1)
    if sr != SR:
        # all current piper zh voices are 22.05 kHz; this is only a guard
        n = int(round(len(x) * SR / sr))
        x = np.interp(np.linspace(0, len(x) - 1, n), np.arange(len(x)), x).astype(np.float32)
    return _trim(_fade(x))


def synth_narration(piper: Piper, text: str, cache_key: str) -> np.ndarray:
    tag = hashlib.md5((text + f"|{LENGTH_SCALE}").encode("utf-8")).hexdigest()[:12]
    wav_path = NARR / f"{cache_key}.wav"
    meta_path = NARR / f"{cache_key}.json"
    if wav_path.exists() and meta_path.exists():
        try:
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
            if meta.get("tag") == tag:
                with wave.open(str(wav_path), "rb") as w:
                    raw = w.readframes(w.getnframes())
                return np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32767.0
        except Exception:
            pass

    chunks = _sentences(text)
    pieces = []
    t0 = time.time()
    for i, s in enumerate(chunks):
        x = _tts_chunk(piper, s)
        if len(x) == 0:
            continue
        pieces.append(x)
        # pause after sentence, a touch longer after a question / semicolon
        pause = 0.30 if s.rstrip()[-1:] in "？！?!" else (0.22 if s.rstrip()[-1:] in "；;" else 0.17)
        pieces.append(np.zeros(int(pause * SR), dtype=np.float32))
    if not pieces:
        raise RuntimeError(f"no narration generated for {cache_key}")
    x = np.concatenate(pieces)
    peak = float(np.max(np.abs(x))) or 1.0
    x = (x / peak * 0.92).astype(np.float32)
    with wave.open(str(wav_path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes((np.clip(x, -1, 1) * 32767).astype(np.int16).tobytes())
    meta_path.write_text(json.dumps({"tag": tag, "duration": len(x) / SR,
                                     "chars": len(text)}, ensure_ascii=False),
                         encoding="utf-8")
    print(f"  tts {cache_key}: {len(text)} chars -> {len(x)/SR:5.1f}s "
          f"({time.time()-t0:4.1f}s synth)")
    return x


# ---------------------------------------------------------------------------
# procedural music (numpy only)
# ---------------------------------------------------------------------------
BPM = 82.0
BEAT = 60.0 / BPM
BAR = 4 * BEAT

# Am9 / Fmaj9 / Cmaj9 / G6
PROG = [
    dict(root=110.00, notes=[220.00, 261.63, 329.63, 392.00, 493.88]),
    dict(root=87.31, notes=[174.61, 220.00, 261.63, 329.63, 392.00]),
    dict(root=130.81, notes=[130.81, 164.81, 196.00, 246.94, 293.66]),
    dict(root=98.00, notes=[196.00, 246.94, 293.66, 392.00, 440.00]),
]


def _movavg(x: np.ndarray, k: int, axis=-1):
    if k <= 1:
        return x
    x = np.asarray(x)
    pad = [(0, 0)] * x.ndim
    pad[axis] = (k, 0)
    c = np.cumsum(np.pad(x, pad, mode="edge"), axis=axis, dtype=np.float64)
    sl1 = [slice(None)] * x.ndim
    sl2 = [slice(None)] * x.ndim
    sl1[axis] = slice(k, None)
    sl2[axis] = slice(0, -k)
    return ((c[tuple(sl1)] - c[tuple(sl2)]) / k).astype(np.float32)


def _adsr(n, attack=0.02, decay=0.15, sustain=0.7, release=0.4):
    t = np.arange(n, dtype=np.float32)
    a = max(1, int(attack * SR))
    d = max(1, int(decay * SR))
    r = max(1, int(release * SR))
    env = np.ones(n, dtype=np.float32)
    env[:a] = np.linspace(0, 1, a) ** 0.6
    if a + d < n:
        env[a:a + d] = np.linspace(1, sustain, d)
    if a + d < n:
        env[a + d:] = sustain
    if r < n:
        env[-r:] *= np.linspace(1, 0, r) ** 1.5
    return env


def _add(buf: np.ndarray, start: int, seg: np.ndarray, pan: float = 0.5, gain=1.0):
    n = seg.shape[-1]
    if start >= buf.shape[1]:
        return
    n = min(n, buf.shape[1] - start)
    if n <= 0:
        return
    l = math.cos(pan * math.pi / 2)
    r = math.sin(pan * math.pi / 2)
    buf[0, start:start + n] += seg[:n] * gain * l
    buf[1, start:start + n] += seg[:n] * gain * r


def ambient_score(total_sec: float) -> np.ndarray:
    n_total = int(math.ceil((total_sec + 1.0) * SR))
    n_bars = int(math.ceil(total_sec / BAR)) + 1
    rng = np.random.default_rng(20261106)
    music = np.zeros((2, n_total), dtype=np.float32)

    for b in range(n_bars):
        start = int(b * BAR * SR)
        chord = PROG[b % 4]
        drums = 3 <= b < n_bars - 4

        # --- warm pad
        for i, f in enumerate(chord["notes"]):
            n = int((BAR + 1.1) * SR)
            t = np.arange(n, dtype=np.float32) / SR
            env = _adsr(n, attack=0.5, decay=0.1, sustain=0.85, release=0.9)
            slow = 1.0 + 0.045 * np.sin(2 * np.pi * (0.09 + i * 0.011) * t + i)
            w = (np.sin(2 * np.pi * f * t + i * 0.7)
                 + 0.14 * np.sin(2 * np.pi * 2 * f * t + i * 1.1)
                 + 0.05 * np.sin(2 * np.pi * 3 * f * t + i * 0.3))
            _add(music, start, (w * env * slow * 0.035).astype(np.float32),
                 pan=0.28 + 0.46 * (i / max(1, len(chord["notes"]) - 1)), gain=1.0)

        # --- sub bass, two notes per bar
        for half in range(2):
            f = chord["root"] / 2.0
            n = int(BEAT * 2 * 0.96 * SR)
            t = np.arange(n, dtype=np.float32) / SR
            env = _adsr(n, attack=0.01, decay=0.4, sustain=0.35, release=0.18)
            w = np.sin(2 * np.pi * f * t) + 0.08 * np.sin(2 * np.pi * 2 * f * t)
            _add(music, int((b * BAR + half * 2 * BEAT) * SR),
                 (w * env * 0.11).astype(np.float32), pan=0.5)

        # --- arpeggio / pluck
        pattern = [0, 2, 4, 3, 1, 3, 2, 4]
        for e in range(8):
            idx = pattern[e]
            f = chord["notes"][idx] * 2.0
            n = int(0.42 * SR)
            t = np.arange(n, dtype=np.float32) / SR
            env = np.exp(-t / 0.16) * (1 - np.exp(-t / 0.004))
            w = (np.sin(2 * np.pi * f * t)
                 + 0.22 * np.sin(2 * np.pi * 2.01 * f * t)
                 + 0.08 * np.sin(2 * np.pi * 3.99 * f * t))
            pan = 0.22 if e % 2 == 0 else 0.78
            _add(music, int((b * BAR + e * BEAT / 2 + (0.018 if e % 2 else 0)) * SR),
                 (w * env * 0.036).astype(np.float32), pan=pan)

        if not drums:
            continue

        # --- kick on 1 & 3
        for beat in (0, 2):
            n = int(0.34 * SR)
            t = np.arange(n, dtype=np.float32) / SR
            f = 118.0 * np.exp(-t / 0.045) + 44.0
            phase = 2 * np.pi * np.cumsum(f) / SR
            env = np.exp(-t / 0.14) * (1 - np.exp(-t / 0.002))
            w = np.sin(phase) * env
            w += rng.normal(0, 1, n).astype(np.float32) * np.exp(-t / 0.008) * 0.18
            _add(music, int((b * BAR + beat * BEAT) * SR),
                 (w * 0.14).astype(np.float32), pan=0.5)

        # --- soft snare on 2 & 4
        for beat in (1, 3):
            n = int(0.22 * SR)
            t = np.arange(n, dtype=np.float32) / SR
            noise = rng.normal(0, 1, n).astype(np.float32)
            noise = np.diff(np.concatenate([[0.0], noise])).astype(np.float32)
            env = np.exp(-t / 0.055) * (1 - np.exp(-t / 0.001))
            _add(music, int((b * BAR + beat * BEAT) * SR),
                 (noise * env * 0.018).astype(np.float32), pan=0.56)

        # --- hats on eighths
        for e in range(8):
            n = int(0.075 * SR)
            t = np.arange(n, dtype=np.float32) / SR
            noise = rng.normal(0, 1, n).astype(np.float32)
            noise = np.diff(np.concatenate([[0.0], noise])).astype(np.float32)
            env = np.exp(-t / 0.012)
            amp = 0.012 if e % 2 == 0 else 0.007
            _add(music, int((b * BAR + e * BEAT / 2) * SR),
                 (noise * env * amp).astype(np.float32),
                 pan=0.3 if e % 2 else 0.7)

    # simple stereo multi-tap space, then low-pass the wet signal
    wet = np.zeros_like(music)
    for delay, gain, width in ((0.19, 0.25, 0.55), (0.29, 0.18, 0.75),
                               (0.41, 0.13, 0.35), (0.57, 0.09, 0.65)):
        d = int(delay * SR)
        if d >= n_total:
            continue
        wet[0, d:] += music[0, :-d] * gain * (1 - width)
        wet[1, d:] += music[1, :-d] * gain * width
        wet[0, d:] += music[1, :-d] * gain * 0.12
        wet[1, d:] += music[0, :-d] * gain * 0.12
    wet = _movavg(wet, 41, axis=1).astype(np.float32)
    out = music * 0.82 + wet * 0.42
    out = _movavg(out, 9, axis=1).astype(np.float32)

    # gentle fade in / out
    fin = int(1.6 * SR)
    fout = int(2.2 * SR)
    out[:, :fin] *= np.linspace(0, 1, fin, dtype=np.float32) ** 1.3
    out[:, -fout:] *= np.linspace(1, 0, fout, dtype=np.float32) ** 1.2
    peak = float(np.max(np.abs(out))) or 1.0
    out = (out / peak * 0.78).astype(np.float32)
    return out


# ---------------------------------------------------------------------------
def _write_wav(path: Path, stereo: np.ndarray, sr=SR):
    x = np.clip(stereo, -0.999, 0.999)
    data = (x.T * 32767).astype(np.int16).tobytes()
    with wave.open(str(path), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(data)


def build_audio(force=False):
    t0 = time.time()
    EspeakWrapper.set_library(espeakng_loader.get_library_path())
    EspeakWrapper.set_data_path(espeakng_loader.get_data_path())
    piper = Piper(str(VOICE), str(VOICE_CFG))
    print("piper ready", VOICE.name)

    narrations = []
    for i, meta in enumerate(SLIDES, 1):
        key = f"s{i:02d}"
        print(f"[{i:02d}] {meta['title']}")
        x = synth_narration(piper, meta["text"], key)
        narrations.append(x)

    durations = [PRE + len(x) / SR + POST for x in narrations]
    offsets = np.concatenate([[0.0], np.cumsum(durations)[:-1]])
    total = float(np.sum(durations)) + 0.2
    print(f"narration total {sum(len(x)/SR for x in narrations):.1f}s, "
          f"deck {total:.1f}s; generating score ...")
    t1 = time.time()
    score = ambient_score(total)
    print(f"score {score.shape[1]/SR:.1f}s in {time.time()-t1:.1f}s")

    # export the standalone soundtrack as a bonus
    _write_wav(AUDIO / "soundtrack.wav", score)

    slide_meta = []
    for i, (meta, narr, dur, off) in enumerate(zip(SLIDES, narrations, durations, offsets), 1):
        n = int(round(dur * SR))
        seg = score[:, int(round(off * SR)):int(round(off * SR)) + n].copy()
        if seg.shape[1] < n:
            seg = np.pad(seg, ((0, 0), (0, n - seg.shape[1])))
        npre = int(PRE * SR)
        narr_end = min(n, npre + len(narr))

        # duck the bed under the narration (smooth envelope, full segment length)
        speech = np.zeros(n, dtype=np.float32)
        speech[npre:narr_end] = narr[:narr_end - npre]
        env = _movavg(np.abs(speech)[None, :], int(0.16 * SR), axis=1)[0]
        env = env / (float(env.max()) + 1e-9)
        env = np.clip(env * 2.6, 0, 1)
        env = _movavg(env[None, :], int(0.18 * SR), axis=1)[0]
        duck = 0.48 + 0.52 * (1.0 - env)

        music_gain = 0.22
        left = seg[0] * music_gain * duck
        right = seg[1] * music_gain * duck
        # narration sits in the centre, with a tiny early-reflection lift
        left[npre:narr_end] += narr[:narr_end - npre]
        right[npre:narr_end] += narr[:narr_end - npre]

        mix = np.vstack([left, right])
        peak = float(np.max(np.abs(mix)))
        if peak > 0.98:
            mix *= 0.98 / peak
        wav = AUDIO / f"slide{i:02d}.wav"
        _write_wav(wav, mix)
        slide_meta.append(dict(
            slide=i, title=meta["title"], audio=str(wav), duration=round(dur, 3),
            narration=round(len(narr) / SR, 3), offset=round(float(off), 3),
            pre=PRE, post=POST,
        ))
        print(f"  mix {wav.name}: {dur:5.1f}s  narr {len(narr)/SR:5.1f}s")

    metadata = dict(
        sample_rate=SR, pre=PRE, post=POST, total=round(total, 3),
        soundtrack=str(AUDIO / "soundtrack.wav"), slides=slide_meta,
    )
    (AUDIO / "audio_meta.json").write_text(
        json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"audio done in {time.time()-t0:.1f}s -> {AUDIO}")
    return metadata


if __name__ == "__main__":
    build_audio(force="--force" in sys.argv)
