$goodPart = Get-Content -Path 'c:\Users\dekoo\Documents\crm\public\js\modules\chat-handlers.js' -TotalCount 1545 -Encoding UTF8
$newPart = Get-Content -Path 'c:\Users\dekoo\Documents\crm\tmp_handlers_fix.js' -Raw -Encoding UTF8
$final = ($goodPart -join "`r`n") + "`r`n" + $newPart
[System.IO.File]::WriteAllText('c:\Users\dekoo\Documents\crm\public\js\modules\chat-handlers.js', $final, [System.Text.Encoding]::UTF8)
