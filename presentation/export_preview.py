import os
from pathlib import Path
import win32com.client as w
base=Path(r'F:/AI-OJ-Match/presentation')
ppt=base/'output'/'NoldOJ_Evaluation_Report.pptx'
prev=base/'output'/'preview'; prev.mkdir(exist_ok=True)
app=w.gencache.EnsureDispatch('PowerPoint.Application')
pres=app.Presentations.Open(str(ppt), WithWindow=False)
print('opened', pres.Slides.Count)
for i in range(1,pres.Slides.Count+1):
    pres.Slides(i).Export(str(prev/f'slide{i:02d}.png'), 'PNG', 1600, 900)
pres.Close(); app.Quit()
print('done')
