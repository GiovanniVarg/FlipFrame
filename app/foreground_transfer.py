"""Observed-background foreground transfer. No novel-view synthesis or provider calls."""
import warnings
import cv2
import numpy as np

def build_clean_plate(frames,masks):
 if len(frames)<2 or len(frames)!=len(masks):raise ValueError('At least two reviewed source donor frames are required.')
 stack=np.stack(frames).astype(np.float32)
 for i,mask in enumerate(masks):
  excluded=cv2.dilate(mask.astype(np.uint8),np.ones((7,7),np.uint8))>0
  stack[i,excluded]=np.nan
 count=np.isfinite(stack[...,0]).sum(axis=0)
 with warnings.catch_warnings():
  warnings.simplefilter('ignore',RuntimeWarning)
  median=np.nanmedian(stack,axis=0)
  spread=np.nanmax(np.abs(stack-median[None]),axis=(0,3))
 valid=(count>=2)&np.isfinite(spread)&(spread<=20)
 return np.nan_to_num(median).astype(np.uint8),valid

def compose_foreground(source,candidate,old,new,envelope,protected,plate,valid,placement):
 h,w=old.shape;s=float(placement['scale']);dx=float(placement['x'])*w;dy=float(placement['y'])*h
 if not np.isfinite([s,dx,dy]).all() or not .25<=s<=3:raise ValueError('Invalid foreground placement.')
 background=(old==0)&valid
 delta=np.max(cv2.absdiff(source,plate),axis=2)[background]
 if background.mean()<.25 or not len(delta) or np.median(delta)>8 or np.percentile(delta,90)>28:raise ValueError('Source camera or background is moving. Foreground transfer needs a stable observed background; use scene replacement or aligned mode.')
 # Fixed image-center pivot avoids per-frame bounding-box scale pumping.
 matrix=np.float32([[s,0,dx+(1-s)*w/2],[0,s,dy+(1-s)*h/2]])
 alpha=cv2.warpAffine(new.astype(np.float32),matrix,(w,h),flags=cv2.INTER_LINEAR)
 premult=cv2.warpAffine(candidate.astype(np.float32)*new[...,None],matrix,(w,h),flags=cv2.INTER_LINEAR)
 removal=cv2.dilate(old.astype(np.uint8),np.ones((5,5),np.uint8))>0
 support=removal|(alpha>0)
 if not (alpha>0).any():raise ValueError('Replacement placement is outside the frame.')
 if np.any(support & (envelope==0)):raise ValueError('Foreground or removal extends outside the approved repair area.')
 if np.any(support & (protected>0)):raise ValueError('Foreground overlaps a protected region.')
 if np.any(removal & ~valid):raise ValueError('Source background has unobserved or inconsistent pixels under the old object. No background was invented. Review more source donor frames or use scene replacement.')
 out=source.copy();out[removal]=plate[removal]
 composited=np.rint(out*(1-alpha[...,None])+premult).clip(0,255).astype(np.uint8)
 out[support]=composited[support]
 return out,support
