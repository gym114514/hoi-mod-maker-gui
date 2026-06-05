$f = "C:\Users\31077\.qclaw\workspace\hoi-mod-maker-gui\src-tauri\src\parser.rs"
$content = [System.IO.File]::ReadAllText($f, [System.Text.Encoding]::UTF8)
# Remove BOM if present
$content = $content.TrimStart([char]0xFEFF)
# Replace literal \n with actual newlines
$content = $content -replace '\\n', "`n"
[System.IO.File]::WriteAllText($f, $content, [System.Text.Encoding]::UTF8)
Write-Host "Fixed parser.rs ($($content.Length) chars)"

$f2 = "C:\Users\31077\.qclaw\workspace\hoi-mod-maker-gui\src-tauri\src\validator.rs"
$content2 = [System.IO.File]::ReadAllText($f2, [System.Text.Encoding]::UTF8)
$content2 = $content2.TrimStart([char]0xFEFF)
$content2 = $content2 -replace '\\n', "`n"
[System.IO.File]::WriteAllText($f2, $content2, [System.Text.Encoding]::UTF8)
Write-Host "Fixed validator.rs ($($content2.Length) chars)"
