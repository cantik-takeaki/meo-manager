/* Local preview theme derived from each store's official website. */
window.applyHPTheme = function(store) {
  const hp=store.hp;if(!hp)return;
  document.body.dataset.hp=hp.layout;
  const v=document.documentElement.style;
  for(const [k,val] of Object.entries({brand:hp.brand,gold:hp.gold,ground:hp.paper,paper:hp.paper,display:hp.font,'hp-button':hp.button||hp.brand,'hp-on-button':hp.onButton||'#fff'}))v.setProperty('--'+k,val);
  if(hp.body)v.setProperty('--sans',hp.body);
  if(hp.texture)v.setProperty('--hp-texture',`url("${new URL(hp.texture,document.baseURI).href}")`);
  if(hp.hero)document.getElementById('storePhoto').src=hp.hero;
  if(hp.logo){
    const img=document.createElement('img');img.src=hp.logo;img.alt=store.displayName;img.className='hp-logo';
    if(hp.logoCrop){
      const c=hp.logoCrop,frame=document.createElement('span');frame.className='hp-logo-crop';
      frame.style.aspectRatio=`${c.width} / ${c.height}`;
      img.width=c.sourceWidth;img.height=c.sourceHeight;
      img.style.width=`${c.sourceWidth/c.width*100}%`;img.style.height='auto';
      img.style.left=`${-c.left/c.width*100}%`;img.style.top=`${-c.top/c.height*100}%`;
      frame.append(img);document.getElementById('headerName').replaceChildren(frame);
    }else{document.getElementById('headerName').replaceChildren(img);}
  }
};
