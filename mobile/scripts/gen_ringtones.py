"""
Generates VOXO's ringtones.

Synthesised rather than sourced: a ringtone shipped in an APK is
redistributed with it, and eight files of unclear provenance is eight
licensing questions nobody wants to answer later. These are plain
arithmetic, so there is nothing to license.

22.05 kHz mono, which is more than a ringtone needs and half the bytes of
44.1 — eight of these ride in the APK.

Each ends in silence on purpose. useRinger loops the file, so the gap IS
the pause between rings; without it a loop is one unbroken tone.
"""
import numpy as np, wave, struct, pathlib, sys

SR = 22050

def tone(freq, dur, amp=0.5, decay=None, harm=(1.0,)):
    """A note. `decay` gives a plucked shape; harmonics soften a bare sine."""
    t = np.linspace(0, dur, int(SR * dur), endpoint=False)
    wave_ = np.zeros_like(t)
    for i, h in enumerate(harm, start=1):
        wave_ += h * np.sin(2 * np.pi * freq * i * t)
    wave_ /= sum(harm)
    if decay is not None:
        wave_ *= np.exp(-decay * t)
    else:
        # 8 ms in/out, so nothing starts or stops on a click.
        e = int(SR * 0.008)
        env = np.ones_like(t)
        env[:e] = np.linspace(0, 1, e)
        env[-e:] = np.linspace(1, 0, e)
        wave_ *= env
    return wave_ * amp

def silence(dur):
    return np.zeros(int(SR * dur))

def warble(f1, f2, dur, rate=20.0, amp=0.5):
    """The two-tone burst a bell phone makes."""
    t = np.linspace(0, dur, int(SR * dur), endpoint=False)
    sw = (np.sign(np.sin(2 * np.pi * rate * t)) + 1) / 2
    w = sw * np.sin(2 * np.pi * f1 * t) + (1 - sw) * np.sin(2 * np.pi * f2 * t)
    e = int(SR * 0.01)
    env = np.ones_like(t); env[:e] = np.linspace(0, 1, e); env[-e:] = np.linspace(1, 0, e)
    return w * env * amp

N = {'C5':523.25,'D5':587.33,'E5':659.25,'F5':698.46,'G5':783.99,'A5':880.00,'B5':987.77,
     'C6':1046.5,'D6':1174.7,'E6':1318.5,'G6':1568.0,'A4':440.0,'C4':261.6,'E4':329.6,'G4':392.0}

def classic():   # a bell telephone
    ring = np.concatenate([warble(440, 480, 0.9, 20), silence(0.25)])
    return np.concatenate([ring, ring, silence(1.6)])

def chime():     # three descending bells
    return np.concatenate([
        tone(N['G6'], 0.5, 0.45, decay=5, harm=(1, .35, .12)),
        tone(N['E6'], 0.5, 0.45, decay=5, harm=(1, .35, .12)),
        tone(N['C6'], 0.9, 0.45, decay=3.2, harm=(1, .35, .12)),
        silence(1.4)])

def pulse():     # short, insistent beeps
    b = np.concatenate([tone(N['A5'], 0.11, 0.5), silence(0.09)])
    return np.concatenate([b, b, b, silence(1.1)])

def marimba():   # wooden, plucked
    seq = ['C5','E5','G5','E5','C6','G5']
    parts = [tone(N[n], 0.17, 0.5, decay=11, harm=(1, .5, .25)) for n in seq]
    return np.concatenate(parts + [silence(1.5)])

def bells():     # high and shimmering
    return np.concatenate([
        tone(N['C6'], 0.34, 0.4, decay=6.5, harm=(1, .6, .3, .15)),
        tone(N['G6'], 0.34, 0.4, decay=6.5, harm=(1, .6, .3, .15)),
        tone(N['E6'], 0.34, 0.4, decay=6.5, harm=(1, .6, .3, .15)),
        tone(N['C6'], 0.8, 0.4, decay=4.0, harm=(1, .6, .3, .15)),
        silence(1.3)])

def digital():   # a rising synthetic arpeggio
    seq = ['C5','G5','C6','E6']
    parts = [tone(N[n], 0.13, 0.42, harm=(1, .45, .3, .18)) for n in seq]
    return np.concatenate(parts + [silence(0.28)] + parts + [silence(1.4)])

def soft():      # low and unhurried
    return np.concatenate([
        tone(N['C4'], 0.7, 0.42, decay=1.6, harm=(1, .3)),
        tone(N['G4'], 0.7, 0.42, decay=1.6, harm=(1, .3)),
        tone(N['E4'], 1.1, 0.42, decay=1.2, harm=(1, .3)),
        silence(1.7)])

def urgent():    # fast triple, repeated — hard to sleep through
    t3 = np.concatenate([tone(N['B5'], 0.08, 0.52), silence(0.05)] * 3)
    return np.concatenate([t3, silence(0.22), t3, silence(1.0)])

TONES = {
    'classic': classic, 'chime': chime, 'pulse': pulse, 'marimba': marimba,
    'bells': bells, 'digital': digital, 'soft': soft, 'urgent': urgent,
}

def write(path, samples):
    peak = float(np.max(np.abs(samples))) or 1.0
    samples = samples / peak * 0.85          # same loudness across the set
    pcm = (samples * 32767).astype('<i2')
    with wave.open(str(path), 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes(pcm.tobytes())

out = pathlib.Path(sys.argv[1]); out.mkdir(parents=True, exist_ok=True)
for name, fn in TONES.items():
    p = out / f'ringtone_{name}.wav'
    write(p, fn())
    print(f'{p.name:26} {p.stat().st_size/1024:6.0f} KB')
