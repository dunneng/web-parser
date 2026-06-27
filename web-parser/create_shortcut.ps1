$Desktop = [Environment]::GetFolderPath("Desktop")
$ShortcutPath = $Desktop + "\WebParser.lnk"
$Target = "H:\web-parser\start.bat"
$WorkDir = "H:\web-parser"

if (Test-Path $ShortcutPath) { Remove-Item $ShortcutPath -Force }

$WshShell = New-Object -ComObject WScript.Shell
$Shortcut = $WshShell.CreateShortcut($ShortcutPath)
$Shortcut.TargetPath = $Target
$Shortcut.WorkingDirectory = $WorkDir
$Shortcut.Save()

Write-Host "Shortcut created."
