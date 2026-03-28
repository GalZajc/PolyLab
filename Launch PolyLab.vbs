Option Explicit

Dim shell, fso, projectDir, distIndex, nodeModulesDir, buildCommand, serverUrl
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

projectDir = fso.GetParentFolderName(WScript.ScriptFullName)
distIndex = projectDir & "\dist\index.html"
nodeModulesDir = projectDir & "\node_modules"
serverUrl = "http://127.0.0.1:4173/"

If Not fso.FolderExists(nodeModulesDir) Then
  buildCommand = "cmd /c cd /d """ & projectDir & """ && npm install && npm run build"
  If shell.Run(buildCommand, 0, True) <> 0 Then
    MsgBox "PolyLab could not install dependencies.", vbCritical, "PolyLab"
    WScript.Quit 1
  End If
ElseIf Not fso.FileExists(distIndex) Then
  buildCommand = "cmd /c cd /d """ & projectDir & """ && npm run build"
  If shell.Run(buildCommand, 0, True) <> 0 Then
    MsgBox "PolyLab could not build the app.", vbCritical, "PolyLab"
    WScript.Quit 1
  End If
End If

If Not UrlResponds(serverUrl & "health") Then
  shell.Run "powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & projectDir & "\Start PolyLab Server.ps1""", 0, False
End If

If WaitForUrl(serverUrl & "health", 15000) Then
  OpenAppWindow serverUrl
Else
  MsgBox "PolyLab server did not start in time.", vbCritical, "PolyLab"
End If

Function UrlResponds(url)
  On Error Resume Next
  Dim xhr
  Set xhr = CreateObject("MSXML2.XMLHTTP")
  xhr.Open "GET", url, False
  xhr.Send
  UrlResponds = (Err.Number = 0 And xhr.Status >= 200 And xhr.Status < 500)
  On Error GoTo 0
End Function

Function WaitForUrl(url, timeoutMs)
  Dim startedAt
  startedAt = Timer
  Do
    If UrlResponds(url) Then
      WaitForUrl = True
      Exit Function
    End If
    WScript.Sleep 250
  Loop While ((Timer - startedAt) * 1000) < timeoutMs
  WaitForUrl = False
End Function

Sub OpenAppWindow(url)
  Dim edgePath, chromePath, profileDir
  edgePath = shell.ExpandEnvironmentStrings("%ProgramFiles(x86)%") & "\Microsoft\Edge\Application\msedge.exe"
  chromePath = shell.ExpandEnvironmentStrings("%ProgramFiles%") & "\Google\Chrome\Application\chrome.exe"
  profileDir = shell.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\PolyLabBrowserProfile"

  If fso.FileExists(edgePath) Then
    shell.Run """" & edgePath & """ --app=" & url & " --user-data-dir=""" & profileDir & """ --disable-features=Translate,msEdgeTranslate,TranslateUI --no-first-run --no-default-browser-check", 1, False
  ElseIf fso.FileExists(chromePath) Then
    shell.Run """" & chromePath & """ --app=" & url & " --user-data-dir=""" & profileDir & """ --disable-features=Translate,TranslateUI --no-first-run --no-default-browser-check", 1, False
  Else
    shell.Run url, 1, False
  End If
End Sub
