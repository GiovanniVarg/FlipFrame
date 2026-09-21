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
  if r.get('replacementShift',0)>.05:reasons.append('replacement-displacement')
  if r.get('silhouetteOverlap',1)<.75:reasons.append('replacement-shape-change')
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


def replacement_metrics(source,replacement):
 import numpy as np
 sy,sx=np.nonzero(source);ry,rx=np.nonzero(replacement)
 if not len(sx) or not len(rx):return {'replacementShift':1.,'silhouetteOverlap':0.}
 scale=max(1.,math.hypot(float(sx.max()-sx.min()),float(sy.max()-sy.min())))
 shift=math.hypot(float(sx.mean()-rx.mean()),float(sy.mean()-ry.mean()))/scale
 union=np.count_nonzero((source!=0)|(replacement!=0))
 return {'replacementShift':round(shift,4),'silhouetteOverlap':round(np.count_nonzero((source!=0)&(replacement!=0))/max(1,union),4)}
