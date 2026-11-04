<?php
declare(strict_types=1);
header('Cache-Control: no-store');
header('Content-Type: application/json');
if ($_SERVER['REQUEST_METHOD']!=='POST') { http_response_code(405); exit; }
$d=json_decode(file_get_contents('php://input',false,null,0,1024),true);
foreach (['code','verifier'] as $k) { if (!is_string($d[$k]??null)||!preg_match('/^[a-f0-9]{64}$/D',$d[$k])) { http_response_code(400); exit; } }
$dir=rtrim(sys_get_temp_dir(), '/').'/cantik-meo-'.hash('sha256',__DIR__);
$path=$dir.'/grant-'.hash('sha256',$d['code']);
$file=@fopen($path,'r+');
if (!$file || !flock($file,LOCK_EX)) { http_response_code(403); exit; }
$r=json_decode(stream_get_contents($file),true);
if (!$r || $r['expires']<time() || !hash_equals($r['challenge'],hash('sha256',$d['verifier']))) { http_response_code(403); exit; }
if (!ftruncate($file,0)) { http_response_code(503); exit; }
unlink($path); fclose($file);
echo json_encode(['shop'=>$r['shop']], JSON_THROW_ON_ERROR);
