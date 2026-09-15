"""
Generates VOXO's ringtones.

Synthesised rather than sourced: a ringtone shipped in an APK is
redistributed with it, and eight files of unclear provenance is eight
licensing questions nobody wants to answer later. These are plain
arithmetic, so there is nothing to license.

22.05 kHz mono. More bandwidth than a ringtone needs — the highest
fundamental here is under 1.6 kHz and its harmonics run out well before
11 kHz — and half the bytes of 44.1.

## Why these are long

Each piece is a FULL RING CYCLE of about ten seconds: several phrases
with real pauses between them, not one short motif.

They used to be two to four seconds, looped. Looping a two-second motif
is not the same thing as a ringtone: the phrase repeats before it has
finished being a phrase, the pauses are all identical, and it becomes
nagging within about six seconds — which is roughly when someone starts
looking for the phone. A real ringtone has a shape that unfolds, and
something to come back to. Ten seconds is long enough for that and short
enough that the loop point is never reached on most answered calls.

They still loop (useRinger and the notification both do), and each still
ends in silence, so the join is a pause rather than a splice.

## Why they sound better

Three things the earlier set did without:

- A decay envelope per PARTIAL rather than one over the whole note. High
  harmonics die faster than the fundamental in anything struck or
  plucked, and that difference is most of what the ear reads as "a bell"
  instead of "a beep".
- Slight inharmonicity on the struck tones. A real bar or bell has
  partials that are not exact integer multiples; exact ones sound
  synthetic in a way that is hard to name and easy to hear.
- A short reverb tail, so a note ends in a room rather than at a wall.
"""
import numpy as np, wave, pathlib, sys

SR = 22050


def _env(n, attack, release):
    """Fade in and out, so nothing starts or stops on a click."""
    e = np.ones(n)
    a = min(int(SR * attack), n // 2)
    r = min(int(SR * release), n // 2)
    if a:
        e[:a] = np.linspace(0, 1, a)
    if r:
        e[-r:] = np.linspace(1, 0, r)
    return e


def struck(freq, dur, amp=0.5, decay=4.0, partials=((1, 1.0), (2, 0.5), (3, 0.22), (4.2, 0.12)),
           stretch=0.0):
    """
    A note that is hit and then rings out — bell, bar, plucked string.

    Each partial gets its OWN decay, faster the higher it is, which is
    what makes a struck note brighten at the attack and mellow as it
    falls away. `stretch` pulls the upper partials slightly sharp, the
    inharmonicity of a real bar; a bell with exact integer partials is
    the sound of a synthesiser pretending.
    """
    t = np.linspace(0, dur, int(SR * dur), endpoint=False)
    out = np.zeros_like(t)
    total = sum(w for _, w in partials)
    for mult, weight in partials:
        f = freq * mult * (1 + stretch * (mult - 1))
        out += weight * np.sin(2 * np.pi * f * t) * np.exp(-decay * mult ** 0.7 * t)
    out /= total
    return out * amp * _env(len(out), 0.003, 0.01)


def sustained(freq, dur, amp=0.5, partials=(1.0, 0.32, 0.14, 0.06), vibrato=0.0):
    """A note that is held — the shape a sung or bowed tone has."""
    t = np.linspace(0, dur, int(SR * dur), endpoint=False)
    out = np.zeros_like(t)
    wobble = 1 + vibrato * np.sin(2 * np.pi * 5.2 * t) if vibrato else 1.0
    for i, weight in enumerate(partials, start=1):
        out += weight * np.sin(2 * np.pi * freq * i * t * wobble if vibrato else 2 * np.pi * freq * i * t)
    out /= sum(partials)
    return out * amp * _env(len(out), 0.04, 0.12)


def silence(dur):
    return np.zeros(int(SR * dur))


def warble(f1, f2, dur, rate=20.0, amp=0.5):
    """The two-tone burst a bell telephone makes."""
    t = np.linspace(0, dur, int(SR * dur), endpoint=False)
    sw = (np.sign(np.sin(2 * np.pi * rate * t)) + 1) / 2
    w = sw * np.sin(2 * np.pi * f1 * t) + (1 - sw) * np.sin(2 * np.pi * f2 * t)
    # A touch of the second harmonic: a real bell hammer is not a sine.
    w += 0.25 * (sw * np.sin(4 * np.pi * f1 * t) + (1 - sw) * np.sin(4 * np.pi * f2 * t))
    return w / 1.25 * amp * _env(len(w), 0.01, 0.02)


def reverb(x, delay=0.055, feedback=0.34, taps=6, mix=0.3):
    """
    A short tail, so notes end in a room rather than at a wall.

    A comb of a handful of decaying echoes — not a real reverb, but the
    difference between this and none at all is the difference between a
    ringtone and a test tone.
    """
    out = x.astype(np.float64).copy()
    d = int(SR * delay)
    for k in range(1, taps + 1):
        g = mix * feedback ** (k - 1)
        out[k * d:] += g * x[: len(x) - k * d]
    return out


N = {
    'C4': 261.63, 'D4': 293.66, 'E4': 329.63, 'F4': 349.23, 'G4': 392.00, 'A4': 440.00, 'B4': 493.88,
    'C5': 523.25, 'D5': 587.33, 'E5': 659.25, 'F5': 698.46, 'G5': 783.99, 'A5': 880.00, 'B5': 987.77,
    'C6': 1046.50, 'D6': 1174.66, 'E6': 1318.51, 'F6': 1396.91, 'G6': 1567.98, 'A6': 1760.00,
}

# Every piece is built to about this, then padded, so the whole set rings
# with the same cadence — one is never twice round while another is still
# on its first phrase.
TARGET = 10.0


# The pause that separates one ring from the next once the file loops.
# Also what guarantees every file ENDS in silence: a piece whose last note
# is still sounding at the join clicks audibly on every repeat.
TAIL = 1.3


def pad_to(x, seconds=TARGET):
    """Trailing silence: always at least TAIL, and up to the common length.

    The gap IS the pause between rings once the file loops, so it is added
    unconditionally rather than only when the piece came in short — a
    reverb tail can push a piece past TARGET, and padding to a length it
    has already exceeded adds nothing and leaves the loop point mid-note.
    """
    x = np.concatenate([x, silence(TAIL)])
    want = int(SR * seconds)
    return x if len(x) >= want else np.concatenate([x, np.zeros(want - len(x))])


def classic():
    """A bell telephone: double ring, long pause, three times over."""
    ring = np.concatenate([warble(440, 480, 0.85, 20), silence(0.22),
                           warble(440, 480, 0.85, 20)])
    return np.concatenate([ring, silence(1.7), ring, silence(1.7), ring])


def chime():
    """Three descending bells, answered an octave down, then once more."""
    def phrase(a, b, c, amp=0.48):
        return np.concatenate([
            struck(N[a], 0.62, amp, decay=3.6, stretch=0.0016),
            struck(N[b], 0.62, amp, decay=3.6, stretch=0.0016),
            struck(N[c], 1.25, amp, decay=2.3, stretch=0.0016),
        ])
    return reverb(np.concatenate([
        phrase('G6', 'E6', 'C6'), silence(0.5),
        phrase('G5', 'E5', 'C5', 0.42), silence(1.1),
        phrase('G6', 'E6', 'C6'), silence(0.4),
        phrase('C6', 'E6', 'G6', 0.44),
    ]))


def pulse():
    """Short insistent beeps in threes — a pager, given a shape."""
    def burst(f, n=3):
        b = np.concatenate([struck(N[f], 0.12, 0.5, decay=26, partials=((1, 1.0), (2, 0.3))),
                            silence(0.1)])
        return np.concatenate([b] * n)
    return np.concatenate([
        burst('A5'), silence(0.6), burst('A5'), silence(1.3),
        burst('C6'), silence(0.6), burst('A5'), silence(1.3),
        burst('A5'),
    ])


def marimba():
    """Wooden and rolling. Struck bars, so the partials are stretched."""
    def run(seq, amp=0.5):
        return np.concatenate([
            struck(N[n], 0.3, amp, decay=9,
                   partials=((1, 1.0), (3.9, 0.42), (9.2, 0.16)), stretch=0.004)
            for n in seq
        ])
    return reverb(np.concatenate([
        run(['C5', 'E5', 'G5', 'E5', 'C6', 'G5']), silence(0.45),
        run(['D5', 'F5', 'A5', 'F5', 'D6', 'A5'], 0.46), silence(0.45),
        run(['C5', 'E5', 'G5', 'C6', 'E6', 'C6']), silence(1.0),
        run(['C5', 'G5', 'C6'], 0.44),
    ]), delay=0.04, mix=0.22)


def bells():
    """High and shimmering, with the inharmonicity a real bell has."""
    P = ((1, 1.0), (2.01, 0.62), (3.02, 0.34), (4.18, 0.2), (5.44, 0.1))
    def peal(notes, amp=0.42, last=1.5):
        parts = [struck(N[n], 0.42, amp, decay=5.2, partials=P, stretch=0.0035) for n in notes[:-1]]
        parts.append(struck(N[notes[-1]], last, amp, decay=2.6, partials=P, stretch=0.0035))
        return np.concatenate(parts)
    return reverb(np.concatenate([
        peal(['C6', 'G6', 'E6', 'C6']), silence(0.55),
        peal(['E6', 'C6', 'G6', 'E6'], 0.4), silence(0.55),
        peal(['C6', 'E6', 'G6', 'C6'], 0.42, 2.2),
    ]), delay=0.07, feedback=0.42, mix=0.36)


def digital():
    """A rising synthetic arpeggio — clean, bright, unapologetically made."""
    def arp(seq, amp=0.42, dur=0.14):
        return np.concatenate([
            struck(N[n], dur, amp, decay=14, partials=((1, 1.0), (2, 0.5), (3, 0.3), (4, 0.18)))
            for n in seq
        ])
    up = ['C5', 'G5', 'C6', 'E6']
    down = ['E6', 'C6', 'G5', 'C5']
    return np.concatenate([
        arp(up), silence(0.24), arp(up), silence(0.9),
        arp(up + down, dur=0.12), silence(0.9),
        arp(up), silence(0.24), arp(['C6', 'E6', 'G6'], dur=0.17),
    ])


def soft():
    """Low and unhurried. Held notes, not struck ones — nothing to
       startle someone who is asleep."""
    def phrase(a, b, c, amp=0.4):
        return np.concatenate([
            sustained(N[a], 0.95, amp, vibrato=0.0016),
            sustained(N[b], 0.95, amp, vibrato=0.0016),
            sustained(N[c], 1.55, amp, vibrato=0.0016),
        ])
    return reverb(np.concatenate([
        phrase('C4', 'G4', 'E4'), silence(0.9),
        phrase('D4', 'A4', 'F4', 0.37), silence(0.9),
        phrase('C4', 'G4', 'C5', 0.4),
    ]), delay=0.085, feedback=0.45, mix=0.4)


def urgent():
    """Fast triples, close together — built to be hard to sleep through,
       and the one in the set that never fully relaxes."""
    def triple(f):
        b = np.concatenate([struck(N[f], 0.085, 0.52, decay=34, partials=((1, 1.0), (2, 0.42))),
                            silence(0.055)])
        return np.concatenate([b] * 3)
    cell = np.concatenate([triple('B5'), silence(0.2), triple('B5'), silence(0.75)])
    high = np.concatenate([triple('D6'), silence(0.2), triple('B5'), silence(0.75)])
    return np.concatenate([cell, high, cell, high, cell])


TONES = {
    'classic': classic, 'chime': chime, 'pulse': pulse, 'marimba': marimba,
    'bells': bells, 'digital': digital, 'soft': soft, 'urgent': urgent,
}


def write(path, samples):
    samples = pad_to(samples)

    # Matched by LOUDNESS, not by peak.
    #
    # Peak normalisation was what this did before, and it is why the bell
    # telephone came out roughly three times as loud as everything else:
    # its two-tone warble is near its peak almost continuously, where a
    # struck bell touches the peak for a few milliseconds and spends the
    # rest of the note decaying. Equal peaks, wildly unequal loudness —
    # and switching ringtone in Settings became a volume change.
    #
    # Measured over the SOUNDING part only. These pieces are a third
    # silence by design, and including it would make the sparse ones
    # (pulse, urgent) come out far too loud to compensate for their gaps.
    quiet = np.max(np.abs(samples)) * 0.02
    sounding = samples[np.abs(samples) > quiet]
    rms = float(np.sqrt((sounding ** 2).mean())) if sounding.size else 1.0
    samples = samples * (0.20 / (rms or 1.0))
    # Then a ceiling, so the match never costs clipping.
    peak = float(np.max(np.abs(samples)))
    if peak > 0.92:
        samples = samples * (0.92 / peak)
    pcm = (samples * 32767).astype('<i2')
    with wave.open(str(path), 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())


out = pathlib.Path(sys.argv[1])
out.mkdir(parents=True, exist_ok=True)
for name, fn in TONES.items():
    p = out / f'ringtone_{name}.wav'
    write(p, fn())
    print(f'{p.name:26} {p.stat().st_size / 1024:6.0f} KB')
