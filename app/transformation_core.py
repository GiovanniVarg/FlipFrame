"""Local bounded transformation compositing. No generation or semantic accuracy claim."""
import cv2
import numpy as np


def align_background(source, candidate, excluded, policy='fixed'):
    h, w = source.shape[:2]
    background = ~cv2.dilate(excluded.astype(np.uint8), np.ones((11, 11), np.uint8)).astype(bool)
    if background.mean() < .25:
        raise ValueError('Too little visible background around the objects to verify camera alignment. Choose replacement footage with more shared background.')
    def residual(image, valid):
        delta = np.max(cv2.absdiff(source, image), axis=2)[background & valid]
        if len(delta) < w*h*.2: raise ValueError('Too little shared background to validate camera alignment.')
        return float(np.median(delta)), float(np.percentile(delta, 90))
    identity = np.eye(3)
    median, p90 = residual(candidate, np.ones((h,w), bool))
    if median <= 8 and p90 <= 28:
        return candidate, identity, np.ones((h,w), bool), {'method':'unchanged-background','medianError':median,'p90Error':p90}
    if policy != 'align':
        raise ValueError('The generated camera or background changed. Try camera alignment, or review a separate scene edit.')
    detector = cv2.SIFT_create(nfeatures=2500)
    mask = (background*255).astype(np.uint8)
    ka, da = detector.detectAndCompute(cv2.cvtColor(source,cv2.COLOR_BGR2GRAY),mask)
    kb, db = detector.detectAndCompute(cv2.cvtColor(candidate,cv2.COLOR_BGR2GRAY),mask)
    if da is None or db is None: raise ValueError('Camera alignment needs more recognizable background detail.')
    pairs = cv2.BFMatcher().knnMatch(db,da,k=2)
    matches = [m[0] for m in pairs if len(m)==2 and m[0].distance < .7*m[1].distance]
    if len(matches)<20: raise ValueError('Camera alignment could not find enough shared background. A scene edit needs separate review.')
    src=np.float32([kb[m.queryIdx].pt for m in matches]);dst=np.float32([ka[m.trainIdx].pt for m in matches])
    matrix,inliers=cv2.findHomography(src,dst,cv2.RANSAC,2.5)
    if matrix is None or inliers.sum()<16 or inliers.mean()<.55: raise ValueError('Camera motion could not be aligned reliably.')
    for points in (src[inliers.ravel()>0],dst[inliers.ravel()>0]):
        if cv2.contourArea(cv2.convexHull(points)) < w*h*.15: raise ValueError('Camera matches are too concentrated to verify the whole repair area.')
    corners=np.float32([[0,0],[w,0],[w,h],[0,h]])[:,None,:]
    warped=cv2.perspectiveTransform(corners,matrix)[:,0,:]
    area=cv2.contourArea(warped)
    if not np.isfinite(warped).all() or not cv2.isContourConvex(warped) or not .5*w*h<area<2*w*h:
        raise ValueError('Camera correction would distort the scene too much.')
    image=cv2.warpPerspective(candidate,matrix,(w,h))
    valid=cv2.warpPerspective(np.ones((h,w),np.uint8),matrix,(w,h),flags=cv2.INTER_NEAREST)>0
    median,p90=residual(image,valid)
    if median>10 or p90>35: raise ValueError('Background still differs after alignment; parallax or regenerated scenery may require a scene edit.')
    return image,matrix,valid,{'method':'background-homography','inliers':int(inliers.sum()),'medianError':median,'p90Error':p90}


def compose_transformation(source,candidate,source_mask,replacement_mask,envelope,protected,policy='fixed',previous=None):
    if source.shape!=candidate.shape: raise ValueError('Source and replacement dimensions must match.')
    h,w=source.shape[:2]
    original=source_mask.astype(bool);replacement=replacement_mask.astype(bool);allowed=envelope.astype(bool)
    if not original.any() or not replacement.any(): raise ValueError('Both object tracks need a visible mask on this frame.')
    if np.any(original & ~allowed): raise ValueError('Original object extends outside the approved repair area.')
    # Permission is a compositing limit, not evidence that background pixels changed.
    # Hiding the entire envelope discards stable landmarks needed for registration.
    aligned,matrix,valid,diagnostics=align_background(source,candidate,original|replacement,policy)
    # Only replacement imagery moves; source and permission coordinates never move.
    replacement=cv2.warpPerspective(replacement.astype(np.uint8),matrix,(w,h),flags=cv2.INTER_NEAREST)>0
    if not replacement.any(): raise ValueError('Replacement moved outside the frame during alignment.')
    if previous is not None:
        corners=np.float32([[0,0],[w,0],[w,h],[0,h]])[:,None,:]
        shift=np.linalg.norm(cv2.perspectiveTransform(corners,matrix)-cv2.perspectiveTransform(corners,previous),axis=2)
        if shift.max()>max(w,h)*.04: raise ValueError('Camera correction jumps between frames; review as a scene edit.')
    core=(original|replacement).astype(np.uint8)
    support=cv2.dilate(core,np.ones((5,5),np.uint8))>0
    if np.any(support & ~allowed): raise ValueError('Transformation reaches outside the approved repair area. Enlarge and review the area first.')
    if np.any(support & protected.astype(bool)): raise ValueError('Transformation overlaps an area marked keep unchanged.')
    if np.any(support & ~valid): raise ValueError('Camera alignment leaves missing pixels inside the repair area.')
    # Candidate supplies inferred background at the vacated source location.
    # Never extrapolate permission over the complete envelope or swept bounding box.
    alpha=np.zeros((h,w),np.float32);alpha[support]=.5;alpha[core>0]=1
    out=source.copy();blend=np.rint(source*(1-alpha[...,None])+aligned*alpha[...,None]).astype(np.uint8)
    out[support]=blend[support]
    if not np.array_equal(out[~support],source[~support]): raise ValueError('Outside-region preservation failed.')
    return out,support,matrix,diagnostics
