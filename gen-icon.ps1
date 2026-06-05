Add-Type -AssemblyName System.Drawing

$size = 32
$bitmap = New-Object System.Drawing.Bitmap($size, $size)
$g = [System.Drawing.Graphics]::FromImage($bitmap)
$g.Clear([System.Drawing.Color]::FromArgb(255, 26, 26, 26))

# Draw gold accent rectangle
$brush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 201, 162, 39))
$g.FillRectangle($brush, 4, 4, 24, 24)

# Draw "H" letter
$font = New-Object System.Drawing.Font("Consolas", 16, [System.Drawing.FontStyle]::Bold)
$textBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 26, 26, 26))
$sf = New-Object System.Drawing.StringFormat
$sf.Alignment = [System.Drawing.StringAlignment]::Center
$sf.LineAlignment = [System.Drawing.StringAlignment]::Center
$rect = New-Object System.Drawing.RectangleF(0, 0, $size, $size)
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAlias
$g.DrawString("H", $font, $textBrush, $rect, $sf)

$g.Dispose()
$font.Dispose()
$brush.Dispose()
$textBrush.Dispose()

# Save as PNG first
$pngPath = "C:\Users\31077\.qclaw\workspace\hoi-mod-maker-gui\src-tauri\icons\icon.png"
$bitmap.Save($pngPath, [System.Drawing.Imaging.ImageFormat]::Png)

# Save as ICO
$icoPath = "C:\Users\31077\.qclaw\workspace\hoi-mod-maker-gui\src-tauri\icons\icon.ico"
$icon = [System.Drawing.Icon]::FromHandle($bitmap.GetHicon())
$fs = [System.IO.FileStream]::new($icoPath, [System.IO.FileMode]::Create)
$icon.Save($fs)
$fs.Close()
$icon.Dispose()
$bitmap.Dispose()

$icoSize = (Get-Item $icoPath).Length
Write-Host "Created icon.ico ($icoSize bytes)"
Write-Host "Created icon.png"
