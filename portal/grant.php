<?php
declare(strict_types=1);
header('Cache-Control: no-store');
header('Referrer-Policy: no-referrer');
$shop = basename(__DIR__);
$actor = $_SERVER['REMOTE_USER'] ?? $_SERVER['REDIRECT_REMOTE_USER'] ?? '';
if ($actor !== $shop || !preg_match('/^[a-z0-9-]{1,40}$/D', $shop)) { http_response_code(403); exit; }
$challenge = $_GET['challenge'] ?? '';
if ($challenge === '') { header('Location: https://meo.cantik.co.jp/api/workspace?action=portal-start&shop='.rawurlencode($shop), true, 303); exit; }
if (!is_string($challenge) || !preg_match('/^[a-f0-9]{64}$/D', $challenge)) { http_response_code(400); exit; }
$dir = rtrim(sys_get_temp_dir(), '/').'/cantik-meo-'.hash('sha256', dirname(__DIR__));
umask(0077);
if ((!is_dir($dir) && !mkdir($dir,0700) && !is_dir($dir)) || is_link($dir) || (fileperms($dir)&0077)) { http_response_code(503); exit; }
foreach (glob($dir.'/grant-*') ?: [] as $old) { if (filemtime($old) < time()-180) { @unlink($old); } }
$code = bin2hex(random_bytes(32));
$file = fopen($dir.'/grant-'.hash('sha256',$code), 'x');
if (!$file) { http_response_code(503); exit; }
$receipt = json_encode(['shop'=>$shop,'challenge'=>$challenge,'expires'=>time()+120],JSON_THROW_ON_ERROR);
if (fwrite($file,$receipt)!==strlen($receipt)) { fclose($file); http_response_code(503); exit; }
fclose($file);
header('Location: https://meo.cantik.co.jp/api/workspace?action=portal-return&code='.$code, true, 303);
