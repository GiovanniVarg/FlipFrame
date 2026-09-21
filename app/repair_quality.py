"""Heuristic review flags, never a semantic accuracy score."""
import math

def frame_metrics(index, authored, support):
 import numpy as np
 ay,ax=np.nonzero(authored); sy,sx=np.nonzero(support)
 return {'frame':index,'selectedPixels':int(len(ax)),'coveragePixels':int(len(sx)),
         'centerX':float(ax.mean()) if len(ax) else 0.,'centerY':float(ay.mean()) if len(ay) else 0.}

def summarize(rows,width,height):
 warnings=[];previous=None;maximum=0.
 for r in rows:
  area=r['selectedPixels'];ratio=r['coveragePixels']/max(1,area);maximum=max(maximum,ratio)
  reasons=[]
  if not area:reasons.append('missing-selection')
  if ratio>3:reasons.append('wide-cleanup')
  if previous and r['frame']==previous['frame']+1:
   old=previous['selectedPixels']
   if old and (area/old>2 or area/old<.5):reasons.append('area-change')
   jump=math.hypot(r['centerX']-previous['centerX'],r['centerY']-previous['centerY'])
   if jump>math.hypot(width,height)*.08:reasons.append('position-jump')
  if reasons:warnings.append({'frame':r['frame'],'seconds':round(r['frame']/30,3),'reasons':reasons})
  previous=r
 return {'version':1,'assessedFrames':len(rows),'maxExpansionRatio':round(maximum,3),'flaggedFrames':len(warnings),'warnings':warnings[:30],'heuristic':True}
