<?php
/**
 * Plugin Name: ラクラクMEO 店舗情報連携
 * Description: 店舗の正式情報を管理し、掲載用ブロックとラクラクMEOへの照合データを作成します。
 * Version: 0.1.0
 * Requires at least: 6.2
 * Requires PHP: 8.0
 * License: GPL-2.0-or-later
 */
if (!defined('ABSPATH')) { exit; }
final class Rakuraku_MEO {
 const KEY = 'rakuraku_meo_profile';
 static function tr($key) {
  static $dict=null;if($dict===null)$dict=json_decode(file_get_contents(__DIR__.'/messages.json'),true);
  $locale=substr(determine_locale(),0,2);if(!isset($dict[$locale]))$locale='en';return $dict[$locale][$key]??$key;
 }
 static function labels() {$out=array();foreach(array('name','address','telephone','hours','reservationUrl') as $key)$out[$key]=self::tr($key);return $out;}

 static function clean($input) {
  $input=is_array($input)?$input:array();$out=array();
  foreach(self::labels() as $k=>$label) {
   $v=isset($input[$k])&&is_scalar($input[$k])?(string)$input[$k]:'';
   $out[$k]=$k==='reservationUrl'?esc_url_raw($v,array('http','https')):sanitize_textarea_field($v);
   if($k==='reservationUrl'&&$out[$k]){$parts=wp_parse_url($out[$k]);if(!empty($parts['user'])||!empty($parts['pass'])||preg_match('/(?:token|password|secret|api.?key|auth)=/i',$parts['query']??''))$out[$k]='';}
   $out[$k]=mb_substr($out[$k],0,2000);
  }
  $out['publish']=in_array($input['publish']??false,array('1',1,true),true);
  $out['updatedAt']=gmdate('c');return $out;
 }
 static function profile() { $v=get_option(self::KEY,array());return is_array($v)?$v:array(); }
 static function report() {
  $p=self::profile();$fields=array();foreach(self::labels() as $k=>$label)$fields[$k]=isset($p[$k])?(string)$p[$k]:'';
  return array('schema'=>'rakuraku-meo-wordpress/v1','pluginVersion'=>'0.1.0','siteUrl'=>home_url('/'),'observedAt'=>gmdate('c'),'profile'=>$fields,'published'=>!empty($p['publish']),'profileUpdatedAt'=>$p['updatedAt']??null);
 }
 static function register() { register_setting('rakuraku_meo',self::KEY,array('type'=>'array','sanitize_callback'=>array(__CLASS__,'clean'),'show_in_rest'=>false)); }
 static function menu() { add_options_page('ラクラクMEO','ラクラクMEO','manage_options','rakuraku-meo',array(__CLASS__,'page')); }
 static function page() {
  if(!current_user_can('manage_options'))return;
  $p=self::profile();echo '<div class="wrap"><h1>'.esc_html(self::tr('title')).'</h1><p>'.esc_html(self::tr('intro')).'</p><form method="post" action="options.php">';
  settings_fields('rakuraku_meo');echo '<table class="form-table" role="presentation">';
  foreach(self::labels() as $k=>$label)echo '<tr><th><label for="rmeo-'.esc_attr($k).'">'.esc_html($label).'</label></th><td><textarea class="large-text" rows="2" id="rmeo-'.esc_attr($k).'" name="'.self::KEY.'['.esc_attr($k).']">'.esc_textarea($p[$k]??'').'</textarea></td></tr>';
  echo '</table><p>'.esc_html(self::tr('privacy')).'</p><label><input type="checkbox" name="'.self::KEY.'[publish]" value="1" '.checked(!empty($p['publish']),true,false).'>'.esc_html(self::tr('publish')).'</label>';
  submit_button();echo '</form><h2>'.esc_html(self::tr('block')).'</h2><p>'.esc_html(self::tr('blockHelp')).'</p><h2>'.esc_html(self::tr('exportTitle')).'</h2><p>'.esc_html(self::tr('exportHelp')).'</p><form method="post" action="'.esc_url(admin_url('admin-post.php')).'"><input type="hidden" name="action" value="rakuraku_meo_export">';
  wp_nonce_field('rakuraku_meo_export');submit_button(self::tr('export'),'secondary');echo '</form></div>';
 }
 static function export() {
  if(!current_user_can('manage_options'))wp_die(self::tr('forbidden'),'',array('response'=>403));
  check_admin_referer('rakuraku_meo_export');nocache_headers();header('Content-Type: application/json; charset=utf-8');header('Content-Disposition: attachment; filename="rakuraku-meo.json"');echo wp_json_encode(self::report(),JSON_UNESCAPED_UNICODE|JSON_PRETTY_PRINT);exit;
 }
 static function shortcode() {
  $p=self::profile();if(empty($p['publish'])||empty($p['name']))return '';
  $html='<section class="rakuraku-meo-profile"><h2>'.esc_html($p['name']).'</h2><dl>';
  foreach(array('address','telephone','hours') as $k)if(!empty($p[$k]))$html.='<dt>'.esc_html(self::labels()[$k]).'</dt><dd>'.nl2br(esc_html($p[$k])).'</dd>';
  $html.='</dl>';if(!empty($p['reservationUrl']))$html.='<p><a href="'.esc_url($p['reservationUrl']).'">'.esc_html(self::tr('reserve')).'</a></p>';
  $schema=array('@context'=>'https://schema.org','@type'=>'LocalBusiness','@id'=>home_url('/').'#rakuraku-meo-business','name'=>$p['name'],'url'=>home_url('/'));
  foreach(array('address','telephone') as $k)if(!empty($p[$k]))$schema[$k]=$p[$k];
  return $html.'<script type="application/ld+json">'.wp_json_encode($schema,JSON_HEX_TAG|JSON_HEX_AMP|JSON_HEX_APOS|JSON_HEX_QUOT|JSON_UNESCAPED_UNICODE).'</script></section>';
 }
 static function rest() {register_rest_route('rakuraku-meo/v1','/profile',array('methods'=>'GET','permission_callback'=>function(){return current_user_can('manage_options');},'callback'=>function(){return rest_ensure_response(self::report());}));}
}
add_action('admin_init',array('Rakuraku_MEO','register'));
add_action('admin_menu',array('Rakuraku_MEO','menu'));
add_action('admin_post_rakuraku_meo_export',array('Rakuraku_MEO','export'));
add_action('rest_api_init',array('Rakuraku_MEO','rest'));
add_shortcode('rakuraku_meo_profile',array('Rakuraku_MEO','shortcode'));
