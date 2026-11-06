import wave, numpy as np
from pathlib import Path
base=Path('presentation/assets/audio')
def read(p):
    with wave.open(str(p),'rb') as w:
        n=w.getnframes(); ch=w.getnchannels(); d=np.frombuffer(w.readframes(n),dtype=np.int16).astype(np.float32)/32767
    return d.reshape(-1,ch)
for i in (1,6):
    x=read(base/f'slide{i:02d}.wav')[:,0]
    print(i,'mix rms',20*np.log10(np.sqrt(np.mean(x**2))+1e-9),'peak',20*np.log10(np.max(np.abs(x))+1e-9))
    n=read(base/'narration'/f's{i:02d}.wav')[:,0]
    print('  narr rms',20*np.log10(np.sqrt(np.mean(n**2))+1e-9),'peak',20*np.log10(np.max(np.abs(n))+1e-9))
    # music only tail 0.8s
    tail=x[-int(0.8*22050):]
    print('  tail music rms',20*np.log10(np.sqrt(np.mean(tail**2))+1e-9))
