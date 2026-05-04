# Script para vaciar bucket S3 con versionado habilitado
$bucket = "img-proc-dev-507744946112-us-east-2"
$region = "us-east-2"

Write-Host "Borrando versiones de objetos..." -ForegroundColor Yellow

# Borrar cada version manualmente
$versions = @(
    @{Key="uploads/1c4e1f07-326a-4ec1-8be0-7b78c7de341c.jpg";  VersionId="NI8W6SmVjA90oPuyAzXIuqL2LPJldtEM"},
    @{Key="uploads/559c2880-642b-431b-821c-20181e932d74.webp"; VersionId="_aRDWy6SDVcZnG_pGSkybhBKRfHDJafG"},
    @{Key="uploads/c7503edf-8c01-47bd-a932-22c1bc676d9a.png";  VersionId="Uh9iUlcwxEQ8AlXaICP7BREf6oyLm8gr"},
    @{Key="uploads/f459de98-ec33-4d2d-88fe-9959587807fe.jpeg"; VersionId="jqglyte_yHNUr6ulGEP0mhFlY3CgoUf0"},
    @{Key="uploads/fe31597b-5ee8-42e7-847c-27c7a9f8caea.jpg";  VersionId="d0v.5mPp2LEDb_dKOgirME2PlrPafHzE"}
)

foreach ($v in $versions) {
    Write-Host "Borrando: $($v.Key)" -ForegroundColor Cyan
    aws s3api delete-object `
        --bucket $bucket `
        --key $v.Key `
        --version-id $v.VersionId `
        --region $region
}

Write-Host "`nBorrando delete markers..." -ForegroundColor Yellow
# Borrar delete markers si los hay
$markers = aws s3api list-object-versions --bucket $bucket --region $region --query 'DeleteMarkers[].{Key:Key,VersionId:VersionId}' --output json | ConvertFrom-Json

if ($markers) {
    foreach ($m in $markers) {
        Write-Host "Borrando marker: $($m.Key)" -ForegroundColor Cyan
        aws s3api delete-object `
            --bucket $bucket `
            --key $m.Key `
            --version-id $m.VersionId `
            --region $region
    }
} else {
    Write-Host "No hay delete markers." -ForegroundColor Green
}

Write-Host "`nListo. Intentando borrar el stack..." -ForegroundColor Green
aws cloudformation delete-stack --stack-name image-processor-dev --region us-east-2
Write-Host "Comando enviado. Espera 2-3 minutos y refresca CloudFormation." -ForegroundColor Green
