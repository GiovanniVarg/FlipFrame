"""Conservative reference-feature reacquisition; not semantic segmentation."""
import cv2
import numpy as np

class AppearanceReference:
    def __init__(self, frame, polygon):
        self.scale=min(1,960/frame.shape[1],540/frame.shape[0])
        gray=self.gray(frame)
        self.polygon=np.asarray(polygon,np.float32)*[gray.shape[1]-1,gray.shape[0]-1]
        self.polygon=self.polygon.astype(np.float32)
        region=np.zeros(gray.shape,np.uint8)
        cv2.fillPoly(region,[np.rint(self.polygon).astype(np.int32)],255)
        # Descriptors near the drawn edge otherwise contain background appearance.
        region=cv2.erode(region,np.ones((5,5),np.uint8))
        self.detector=cv2.SIFT_create(nfeatures=1800,contrastThreshold=.015,edgeThreshold=12)
        self.keys,self.descriptors=self.detector.detectAndCompute(gray,region)
        if self.descriptors is None or len(self.keys)<8:
            raise ValueError('Reference object needs at least 8 distinctive visual features; choose a clearer/larger view or use manual masks')
        self.area=abs(cv2.contourArea(self.polygon))
        if self.area<36:raise ValueError('Reference polygon is too small')
        self.matcher=cv2.BFMatcher(cv2.NORM_L2)

    def gray(self,frame):
        gray=cv2.cvtColor(frame,cv2.COLOR_BGR2GRAY)
        if self.scale<1:gray=cv2.resize(gray,None,fx=self.scale,fy=self.scale,interpolation=cv2.INTER_AREA)
        return gray

    def locate(self,frame):
        gray=self.gray(frame)
        keys,descriptors=self.detector.detectAndCompute(gray,None)
        if descriptors is None or len(keys)<8:return None,0,'No distinctive appearance visible'
        pairs=self.matcher.knnMatch(self.descriptors,descriptors,k=2)
        good=[a for pair in pairs if len(pair)==2 for a,b in [pair] if a.distance<.68*b.distance]
        if len(good)<8:return None,0,'Appearance absent, occluded, or ambiguous'
        # Multiple reference descriptors cannot vote for the same observed feature.
        unique={}
        for match in sorted(good,key=lambda item:item.distance):unique.setdefault(match.trainIdx,match)
        good=list(unique.values())
        if len(good)<8:return None,0,'Insufficient unique appearance matches'
        before=np.float32([self.keys[m.queryIdx].pt for m in good])
        after=np.float32([keys[m.trainIdx].pt for m in good])
        matrix,inliers=cv2.findHomography(before,after,cv2.RANSAC,2.5,maxIters=1500,confidence=.995)
        if matrix is None or inliers is None:return None,0,'No consistent object geometry'
        valid=inliers.ravel().astype(bool)
        confidence=float(valid.mean())
        if valid.sum()<8 or confidence<.7:return None,confidence,'Ambiguous or inconsistent geometry'
        spread=cv2.contourArea(cv2.convexHull(before[valid]))/self.area
        if spread<.12:return None,confidence,'Matches cover too little of the object'
        denominators=self.polygon@matrix[2,:2]+matrix[2,2]
        if (denominators<=0).any() or denominators.max()/denominators.min()>1.8:
            return None,confidence,'Severe perspective change requires a new reference'
        polygon=cv2.perspectiveTransform(self.polygon[None],matrix)[0]
        if not np.isfinite(polygon).all() or (polygon<0).any() or (polygon>[gray.shape[1]-1,gray.shape[0]-1]).any():
            return None,confidence,'Object extends beyond the frame'
        area=abs(cv2.contourArea(polygon))
        if not .2<area/self.area<5:return None,confidence,'Implausible scale change'
        if np.sign(cv2.contourArea(polygon,oriented=True))!=np.sign(cv2.contourArea(self.polygon,oriented=True)):
            return None,confidence,'Reflected or invalid geometry'
        # Feature confidence is not a calibrated probability of object identity.
        return (polygon/[gray.shape[1]-1,gray.shape[0]-1]).tolist(),round(confidence,4),None
