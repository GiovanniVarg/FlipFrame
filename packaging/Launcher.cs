using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;

internal static class Launcher {
 static Process server;
 static StreamWriter log;
 static readonly object logLock=new object();
 static string url;
 static void Write(string message){lock(logLock){if(log!=null){log.WriteLine(DateTime.UtcNow.ToString("o")+" "+message);log.Flush();}}}
 static string Arg(string value){return "\""+value.Replace("\"", "\\\"")+"\"";}
 static int FreePort(bool smoke){if(!smoke){try{var fixedPort=new TcpListener(IPAddress.Loopback,8780);fixedPort.Start();fixedPort.Stop();return 8780;}catch(SocketException){}}var listener=new TcpListener(IPAddress.Loopback,0);listener.Start();int port=((IPEndPoint)listener.LocalEndpoint).Port;listener.Stop();return port;}
 static void Start(string userDir,bool smoke){
  string root=AppDomain.CurrentDomain.BaseDirectory, app=Path.Combine(root,"app"), node=Path.Combine(root,"runtime","node","node.exe"), python=Path.Combine(root,"runtime","python","python.exe");
  if(!File.Exists(node)||!File.Exists(python)||!File.Exists(Path.Combine(app,"dist","index.html")))throw new Exception("Extract the complete FlipFrame ZIP before opening FlipFrame.exe.");
  Directory.CreateDirectory(userDir);Directory.CreateDirectory(Path.Combine(userDir,"logs"));
  log=new StreamWriter(Path.Combine(userDir,"logs","launcher.log"),true);
  int port=FreePort(smoke);url="http://127.0.0.1:"+port+"/studio";
  var info=new ProcessStartInfo(node,Arg(Path.Combine(app,"server.mjs"))){WorkingDirectory=app,UseShellExecute=false,CreateNoWindow=true,RedirectStandardOutput=true,RedirectStandardError=true};
  info.EnvironmentVariables["LAB_MODE"]="local";info.EnvironmentVariables["HOST"]="127.0.0.1";info.EnvironmentVariables["PORT"]=port.ToString();
  info.EnvironmentVariables["FLIPFRAME_USER_DIR"]=userDir;info.EnvironmentVariables["LAB_DATA_DIR"]=Path.Combine(userDir,"data");info.EnvironmentVariables["PYTHON"]=python;
  string samPython=Path.Combine(userDir,".segmentation-env","Scripts","python.exe");
  info.EnvironmentVariables["SEGMENTATION_PYTHON"]=samPython;
  info.EnvironmentVariables["SAM2_CHECKPOINT"]=Path.Combine(userDir,".segmentation","sam2.1_hiera_tiny.pt");
  info.EnvironmentVariables["SAM2_ENV_ROOT"]=Path.Combine(userDir,".segmentation-env");
  info.EnvironmentVariables["SAM2_DEVICE"]="auto";
  server=new Process(){StartInfo=info,EnableRaisingEvents=true};server.OutputDataReceived+=(s,e)=>{if(e.Data!=null)Write(e.Data);};server.ErrorDataReceived+=(s,e)=>{if(e.Data!=null)Write(e.Data);};
  server.Start();server.BeginOutputReadLine();server.BeginErrorReadLine();
  for(int i=0;i<120;i++){
   if(server.HasExited)throw new Exception("FlipFrame could not start. See "+Path.Combine(userDir,"logs","launcher.log"));
   try{var request=(HttpWebRequest)WebRequest.Create("http://127.0.0.1:"+port+"/api/health");request.Timeout=1000;using(var response=request.GetResponse())using(var reader=new StreamReader(response.GetResponseStream())){if(reader.ReadToEnd().Contains("\"ok\":true")){if(smoke){var check=(HttpWebRequest)WebRequest.Create("http://127.0.0.1:"+port+"/api/capabilities");check.Timeout=10000;using(var cr=check.GetResponse())using(var body=new StreamReader(cr.GetResponseStream())){string caps=body.ReadToEnd();if(!caps.Contains("\"segmentation\":false")||!caps.Contains("\"higgsfieldVideo\":false"))throw new Exception("Cleanroom capabilities must not enable unconfigured models.");}}Write("Studio ready at "+url);return;}}}catch(WebException){}
   Thread.Sleep(500);
  }
  throw new Exception("FlipFrame did not become ready within one minute. Check the launcher log.");
 }
 static void Stop(){if(server!=null){try{if(!server.HasExited){var killer=Process.Start(new ProcessStartInfo("taskkill.exe","/PID "+server.Id+" /T /F"){UseShellExecute=false,CreateNoWindow=true});killer.WaitForExit(10000);server.WaitForExit(10000);}}catch(Exception e){Write("Stop: "+e.Message);}server.Dispose();server=null;}}
 static void Open(){Process.Start(new ProcessStartInfo(url){UseShellExecute=true});}
 [STAThread] static int Main(string[] args){
  bool smoke=Array.IndexOf(args,"--smoke")>=0;string userDir=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"FlipFrame");
  int custom=Array.IndexOf(args,"--user-dir");if(custom>=0){if(!smoke||custom+1>=args.Length)return 2;userDir=Path.GetFullPath(args[custom+1]);}
  if(smoke){try{Start(userDir,true);return 0;}catch(Exception e){Write(e.Message);return 1;}finally{Stop();}}
  Application.EnableVisualStyles();var form=new Form(){Text="FlipFrame",Width=460,Height=210,StartPosition=FormStartPosition.CenterScreen,FormBorderStyle=FormBorderStyle.FixedDialog,MaximizeBox=false};
  var status=new Label(){Left=20,Top=20,Width=405,Height=70,Text="Starting your local studio…"};
  var open=new Button(){Left=20,Top=110,Width=170,Text="Open studio",Enabled=false};var stop=new Button(){Left=210,Top=110,Width=170,Text="Stop and close"};form.Controls.Add(status);form.Controls.Add(open);form.Controls.Add(stop);
  bool starting=true;open.Click+=(s,e)=>Open();stop.Click+=(s,e)=>form.Close();form.FormClosing+=(s,e)=>{if(starting){e.Cancel=true;status.Text="Please wait for startup to finish before closing.";return;}Stop();};
  form.Shown+=async(s,e)=>{try{await Task.Run(()=>Start(userDir,false));starting=false;status.Text="FlipFrame is running on this computer.\nKeep this window open while editing.";open.Enabled=true;Open();}catch(Exception error){starting=false;status.Text="Could not start. Your saved work is unchanged.";MessageBox.Show(error.Message,"FlipFrame",MessageBoxButtons.OK,MessageBoxIcon.Error);Stop();}};
  Application.Run(form);return 0;
 }
}
