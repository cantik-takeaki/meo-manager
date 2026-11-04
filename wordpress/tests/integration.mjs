import {readFile,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
const runtime='/Users/nanami/Documents/Codex/2026-10-21/new-chat/work/preview-stage/runtime',modules=runtime+'/node_modules';
const {loadNodeRuntime}=await import(pathToFileURL(modules+'/@php-wasm/node/index.js'));
const {bootWordPressAndRequestHandler}=await import(pathToFileURL(modules+'/@wp-playground/wordpress/index.js'));
const source=new URL('../rakuraku-meo/rakuraku-meo.php',import.meta.url);
try{
 const wp=await bootWordPressAndRequestHandler({createPhpRuntime:()=>loadNodeRuntime('8.4',{emscriptenOptions:{processId:984}}),phpVersion:'8.4',siteUrl:'http://127.0.0.1:4498',wordPressZip:new File([await readFile(runtime+'/wordpress-core.zip')],'wordpress.zip'),sqliteIntegrationPluginZip:new File([await readFile(modules+'/@wp-playground/cli/sqlite-database-integration.zip')],'sqlite.zip'),constants:{DISABLE_WP_CRON:true,AUTOMATIC_UPDATER_DISABLED:true,WP_HTTP_BLOCK_EXTERNAL:true,WP_ENVIRONMENT_TYPE:'local'}});
 const php=await wp.getPrimaryPhp();php.mkdirTree('/wordpress/wp-content/plugins/rakuraku-meo');php.writeFile('/wordpress/wp-content/plugins/rakuraku-meo/rakuraku-meo.php',await readFile(source,'utf8'));
 php.writeFile('/wordpress/wp-content/plugins/rakuraku-meo/messages.json',await readFile(new URL('../rakuraku-meo/messages.json',import.meta.url),'utf8'));
 const r=await php.run({code:`<?php
require '/wordpress/wp-load.php';require_once ABSPATH.'wp-admin/includes/plugin.php';
function ensure($v,$label){if(!$v)throw new Exception($label);}
ensure(!is_wp_error(activate_plugin('rakuraku-meo/rakuraku-meo.php')),'有効化');
ensure(Rakuraku_MEO::shortcode()==='','既定非公開');
$p=Rakuraku_MEO::clean(array('name'=>'<b>試験店舗</b>','address'=>'住所','telephone'=>'03-1234-5678','hours'=>'10:00〜22:00','reservationUrl'=>'javascript:alert(1)','publish'=>'1'));
ensure($p['name']==='試験店舗'&&$p['reservationUrl']==='','入力無害化');update_option(Rakuraku_MEO::KEY,$p);
$out=Rakuraku_MEO::shortcode();ensure(str_contains($out,'application/ld+json')&&str_contains($out,'試験店舗'),'公開ブロック');
$report=Rakuraku_MEO::report();ensure($report['schema']==='rakuraku-meo-wordpress/v1'&&$report['profile']['name']==='試験店舗','書出し');
wp_set_current_user(0);$res=rest_do_request(new WP_REST_Request('GET','/rakuraku-meo/v1/profile'));ensure($res->get_status()===401,'匿名拒否');
$admins=get_users(array('role'=>'administrator','number'=>1));wp_set_current_user($admins[0]->ID);$res=rest_do_request(new WP_REST_Request('GET','/rakuraku-meo/v1/profile'));ensure($res->get_status()===200,'管理者取得');
$id=wp_insert_user(array('user_login'=>'reader','user_pass'=>'fixture-only-local','role'=>'subscriber'));wp_set_current_user($id);$res=rest_do_request(new WP_REST_Request('GET','/rakuraku-meo/v1/profile'));ensure($res->get_status()===403,'購読者拒否');
foreach(array('ja'=>'店舗名','en_US'=>'Business name','zh_CN'=>'商家名称','ko_KR'=>'매장명') as $locale=>$label){update_option('WPLANG',$locale);ensure(Rakuraku_MEO::tr('name')===$label,'翻訳');}
ensure(Rakuraku_MEO::clean($p)['publish']===true,'保存再検証');
$p['address']='';update_option(Rakuraku_MEO::KEY,$p);$out=Rakuraku_MEO::shortcode();ensure(!str_contains($out,'"address"'),'非公開住所除外');
$p['publish']=false;update_option(Rakuraku_MEO::KEY,$p);ensure(Rakuraku_MEO::shortcode()==='','公開停止');
echo wp_json_encode(array('wordpress'=>get_bloginfo('version'),'php'=>PHP_VERSION,'passed'=>14));`});
 if(r.exitCode!==0)throw Error(r.errors+' '+r.text);console.log(r.text);await writeFile(new URL('./result.json',import.meta.url),r.text);process.exit(0);
}catch(e){console.error(e);process.exit(1);}
