# claude-blackhole-statusline.ps1
# Windows/PowerShell Claude Code statusLine helper for blackhole_winterminal.hlsl MODE = 2.
# It prints a tiny encoded true-color block first; the Windows Terminal shader samples it.
# Then it prints a normal context progress bar.

$raw = [Console]::In.ReadToEnd()
try {
    $j = $raw | ConvertFrom-Json
} catch {
    $j = $null
}

$pct = 0.0
$model = "Claude"
$dir = ""
if ($null -ne $j) {
    if ($null -ne $j.model -and $null -ne $j.model.display_name) { $model = [string]$j.model.display_name }
    if ($null -ne $j.workspace -and $null -ne $j.workspace.current_dir) { $dir = Split-Path -Leaf ([string]$j.workspace.current_dir) }
    elseif ($null -ne $j.cwd) { $dir = Split-Path -Leaf ([string]$j.cwd) }

    if ($null -ne $j.context_window -and $null -ne $j.context_window.used_percentage) {
        $pct = [double]$j.context_window.used_percentage
    }
}

if ($pct -lt 0) { $pct = 0 }
if ($pct -gt 100) { $pct = 100 }

# Encode 0..100% into 0..250.
$fill = [int][Math]::Round($pct * 2.5)
if ($fill -lt 0) { $fill = 0 }
if ($fill -gt 250) { $fill = 250 }

$hi = [int][Math]::Floor($fill / 16)
$lo = $fill % 16
$chk = ($hi -bxor $lo -bxor 0x5) -band 0xF

# Signature: high nibbles F/B/0. Low nibbles: checksum, high(fill), low(fill).
$r = 0xF0 + $chk
$g = 0xB0 + $hi
$b = 0x00 + $lo

$esc = [char]27
$dataBlock = "$esc[48;2;$r;$g;${b}m  $esc[0m"

$barWidth = 10
$filled = [int][Math]::Round($pct / 100.0 * $barWidth)
if ($filled -lt 0) { $filled = 0 }
if ($filled -gt $barWidth) { $filled = $barWidth }
$empty = $barWidth - $filled
$bar = ("█" * $filled) + ("░" * $empty)

# Keep the data block at the very beginning so TOKEN_DATA_UV can sample it.
# Do not add leading spaces before $dataBlock.
Write-Output ("{0} {1} {2,3}% · {3} · {4}" -f $dataBlock, $bar, [int][Math]::Round($pct), $model, $dir)
