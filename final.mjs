import { chromium } from 'playwright';
const ROUTES=['/','/charts','/search','/playlists','/curators','/login','/terms','/privacy','/notice','/support','/service','/sales-partners'];
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
for(const [w,h,tag] of [[393,852,'아이폰 393'],[412,915,'갤럭시 412'],[1280,800,'태블릿 1280'],[2000,1280,'태블릿 2000']]){
  const ctx=await b.newContext({viewport:{width:w,height:h},isMobile:w<800,hasTouch:true,serviceWorkers:'block'});
  const p=await ctx.newPage(); const errs=[]; const bad=[];
  p.on('pageerror',e=>errs.push(String(e).slice(0,100)));
  for(const r of ROUTES){
    await p.goto('http://127.0.0.1:4173'+r,{waitUntil:'domcontentloaded'});
    await p.evaluate(()=>document.documentElement.classList.add('native-shell'));
    await p.waitForTimeout(1400);
    const res=await p.evaluate(()=>{const vw=innerWidth;const o=[];
      for(const el of document.querySelectorAll('body *')){
        if(getComputedStyle(el).overflowX!=='visible')continue;
        let a=el.parentElement,clip=false;
        while(a){if(getComputedStyle(a).overflowX!=='visible'){clip=true;break;}a=a.parentElement;}
        if(clip)continue;const rc=el.getBoundingClientRect();
        if(rc.width>0&&rc.right>vw+2){o.push(String(el.className).slice(0,34));if(o.length>2)break;}}
      return{h:document.documentElement.scrollWidth>vw+1,o};});
    if(res.h||res.o.length) bad.push(r+' '+JSON.stringify(res.o));
  }
  const m=await p.evaluate(()=>({root:getComputedStyle(document.documentElement).fontSize,
    main:document.querySelector('.app-main > main')?Math.round(document.querySelector('.app-main > main').getBoundingClientRect().width):null,
    sidebar:document.querySelector('.app-sidebar')?getComputedStyle(document.querySelector('.app-sidebar')).display:'없음',
    tabs:document.querySelectorAll('.app-bottom-nav li').length}));
  console.log(tag.padEnd(12),'글자',m.root.padEnd(5),'본문',String(m.main).padEnd(5),'사이드바',m.sidebar.padEnd(6),'탭',m.tabs,
    '| 넘침', bad.length?bad.join(' ; '):'없음', '| JS오류', errs.length?errs[0]:'없음');
  await ctx.close();
}
await b.close();
