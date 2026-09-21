"""Build the rights-free synthetic onboarding fixture locally; no model or network."""
import math, subprocess
from pathlib import Path
import media_engine as media
cv2, np = media.cv2, media.np
root=Path(__file__).parent
command=[media.FFMPEG,'-hide_banner','-loglevel','error','-y','-f','rawvideo','-pixel_format','bgr24','-video_size','640x360','-framerate','30','-i','pipe:0','-f','lavfi','-i','sine=frequency=330:sample_rate=48000:duration=8','-filter:a','volume=0.12','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-t','8','-movflags','+faststart',str(root/'sample-source.mp4')]
process=subprocess.Popen(command,stdin=subprocess.PIPE)
for frame in range(240):
 t=frame/30
 image=np.zeros((360,640,3),np.uint8)
 for y in range(360):
  blend=y/360
  image[y,:]=[int(190-75*blend),int(189-55*blend),int(133+20*blend)]
 cv2.circle(image,(505,79),35,(160,212,244),-1,cv2.LINE_AA)
 cv2.fillPoly(image,[np.array([[0,210],[85,150],[160,210],[255,169],[360,235],[450,194],[640,230],[640,360],[0,360]])],(119,137,100))
 cv2.rectangle(image,(0,246),(640,360),(125,106,51),-1)
 for row in range(5):
  y=263+row*20
  for col in range(8):
   x=int(col*90+math.sin(t*.65+row)*10)
   cv2.line(image,(x,y),(x+46,y),(151,132,70),1,cv2.LINE_AA)
 x=int(105+36*t);y=int(119+math.sin(t*1.4)*13)
 cv2.line(image,(x-12,y+35),(x-8,y+58),(73,89,104),1,cv2.LINE_AA)
 cv2.line(image,(x+12,y+35),(x+8,y+58),(73,89,104),1,cv2.LINE_AA)
 cv2.ellipse(image,(x,y),(31,39),0,0,360,(81,100,213),-1,cv2.LINE_AA)
 cv2.ellipse(image,(x,y),(14,39),0,0,360,(116,151,241),-1,cv2.LINE_AA)
 cv2.rectangle(image,(x-10,y+57),(x+10,y+69),(58,84,112),-1)
 cv2.putText(image,'COASTAL DRIFT',(22,32),cv2.FONT_HERSHEY_SIMPLEX,.55,(231,238,241),1,cv2.LINE_AA)
 cv2.putText(image,'SYNTHETIC PRACTICE CLIP',(22,335),cv2.FONT_HERSHEY_SIMPLEX,.39,(213,224,230),1,cv2.LINE_AA)
 cv2.putText(image,f'{t:04.1f}s',(565,335),cv2.FONT_HERSHEY_SIMPLEX,.4,(213,224,230),1,cv2.LINE_AA)
 process.stdin.write(image.tobytes())
process.stdin.close()
if process.wait()!=0:raise RuntimeError('Sample encoding failed')
print(media.probe(str(root/'sample-source.mp4')))
