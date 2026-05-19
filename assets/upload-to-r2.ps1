$srcDir = "C:\rje\dev\minarealm\assets\start-of-inventory"
$workerDir = "C:\rje\dev\minarealm\worker"
$pub = "https://pub-8d9037b9df7a4082ab5ace47eb40f7de.r2.dev"

$map = @{
    "chevron-amethyst-sphere"  = @("IMG_4101","IMG_4102","IMG_4103","IMG_4104","IMG_4105","IMG_4106","IMG_4107","IMG_4131","IMG_4132","IMG_4133","IMG_4134","IMG_4146")
    "flower-agate-sphere"      = @("IMG_4116","IMG_4136","IMG_4137","IMG_4138","IMG_4139","IMG_4140","IMG_4141","IMG_4147")
    "ruby-zoisite-sphere"      = @("IMG_4111","IMG_4144","IMG_4145","IMG_4148","IMG_4149","IMG_4150","IMG_4151","IMG_4152","IMG_4153","IMG_4155")
    "blue-coral-sphere"        = @("IMG_4117","IMG_4156","IMG_4157","IMG_4158","IMG_4159","IMG_4160","IMG_4161")
    "miriam-stone-sphere"      = @("IMG_4163","IMG_4165","IMG_4166","IMG_4167")
    "larvakite-sphere"         = @("IMG_4108","IMG_4168","IMG_4169","IMG_4170","IMG_4171","IMG_4172","IMG_4173","IMG_4174")
    "labradorite-sphere"       = @("IMG_4113","IMG_4175","IMG_4176","IMG_4177","IMG_4178","IMG_4179","IMG_4180","IMG_4181","IMG_4182")
    "chrome-diopside-sphere"   = @("IMG_4115","IMG_4183","IMG_4184","IMG_4185","IMG_4186","IMG_4188")
    "goldsheen-obsidian-sphere"= @("IMG_4112","IMG_4190","IMG_4191","IMG_4192","IMG_4193","IMG_4194","IMG_4195","IMG_4196")
    "arfedsonite-sphere"       = @("IMG_4214","IMG_4220","IMG_4221","IMG_4222","IMG_4223","IMG_4224","IMG_4225")
    "bloodstone-moon"          = @("IMG_4216","IMG_4217","IMG_4226","IMG_4227","IMG_4228","IMG_4229","IMG_4230","IMG_4231","IMG_4232","IMG_4233")
    "unicorn-heart-carving"    = @("IMG_4236","IMG_4237","IMG_4238","IMG_4239","IMG_4240")
}

$results = @{}
$total = ($map.Values | ForEach-Object { $_.Count } | Measure-Object -Sum).Sum
$done = 0

Push-Location $workerDir

foreach ($product in $map.Keys) {
    $results[$product] = @()
    foreach ($img in $map[$product]) {
        $file = "$srcDir\$img.jpeg"
        if (-not (Test-Path $file)) {
            Write-Host "MISSING: $file" -ForegroundColor Yellow
            continue
        }
        $key = "products/$product/$img.jpeg"
        Write-Host "[$done/$total] Uploading $key ..." -NoNewline
        $out = npx wrangler r2 object put "minarealm-images/$key" --file $file --content-type "image/jpeg" 2>&1
        if ($LASTEXITCODE -eq 0) {
            $url = "$pub/$key"
            $results[$product] += $url
            Write-Host " OK" -ForegroundColor Green
        } else {
            Write-Host " FAILED: $out" -ForegroundColor Red
        }
        $done++
    }
}

Pop-Location

# Emit JSON mapping for use in products.json update
$results | ConvertTo-Json -Depth 4 | Set-Content "C:\rje\dev\minarealm\assets\r2-urls.json"
Write-Host "`nDone. URL map saved to assets\r2-urls.json"
