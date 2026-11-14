// Regression: PC-98 automatically derives 16px cells. The 16–256px input
// remains visible in its grid slot but is visibly grayscale and read-only.
// Leaving PC-98 restores the prior font-render mode and editable px size.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';

const browser=await chromium.launch({
  channel:'chrome',headless:true,args:['--no-sandbox']
});
try{
  const page=await browser.newPage({viewport:{width:1280,height:900}});
  await page.goto(process.env.BOOST_URL||'http://127.0.0.1:39084/');
  await page.click('#tab-converter');
  const $=id=>page.locator('#'+id);
  assert.match(await page.locator('header .brand p').textContent(),/v0\.3\.37/);
  assert.match(await page.locator('footer').textContent(),/検証版 0\.3\.37/);
  await $('video-mode').selectOption('landscape');
  await $('video-font-render').selectOption('legacy');
  await $('video-font-px').fill('48');
  const base=await page.evaluate(()=>{
    const el=document.querySelector('#video-font-setting');
    const input=document.querySelector('#video-font-px');
    const rect=el.getBoundingClientRect();
    return {disabled:input.disabled,locked:el.classList.contains('pc98-locked'),
      x:rect.x,y:rect.y,width:rect.width,px:input.value};
  });
  assert.equal(base.disabled,false);
  assert.equal(base.locked,false);
  assert.equal(base.px,'48');
  await $('video-mode').selectOption('pc98');
  const locked=await page.evaluate(()=>{
    const el=document.querySelector('#video-font-setting');
    const input=document.querySelector('#video-font-px');
    const rect=el.getBoundingClientRect();
    const style=getComputedStyle(el);
    return {disabled:input.disabled,locked:el.classList.contains('pc98-locked'),
      filter:style.filter,opacity:parseFloat(style.opacity),
      aria:el.getAttribute('aria-disabled'),x:rect.x,y:rect.y,width:rect.width,
      px:input.value,renderer:document.querySelector('#video-font-render').value};
  });
  assert.equal(locked.disabled,true,'PC-98 pixel input must not be editable');
  assert.equal(locked.locked,true,'PC-98 label missing grayscale class');
  assert.equal(locked.filter,'grayscale(1)','Font size label is not grayscale');
  assert.ok(locked.opacity<0.65,'Font size label not visibly dimmed');
  assert.equal(locked.aria,'true');
  assert.equal(locked.px,'48','PC-98 must not overwrite the original px value');
  assert.equal(locked.renderer,'native16');
  assert.ok(Math.abs(locked.x-base.x)<1);
  assert.ok(Math.abs(locked.y-base.y)<1,'Graying a setting must not shift rows');
  assert.ok(Math.abs(locked.width-base.width)<1);
  await $('video-mode').selectOption('landscape');
  const restored=await page.evaluate(()=>{
    const el=document.querySelector('#video-font-setting');
    const input=document.querySelector('#video-font-px');
    return {disabled:input.disabled,locked:el.classList.contains('pc98-locked'),
      filter:getComputedStyle(el).filter,px:input.value,
      renderer:document.querySelector('#video-font-render').value};
  });
  assert.equal(restored.disabled,false,'Regular font px must be editable after leaving PC-98');
  assert.equal(restored.locked,false);
  assert.equal(restored.filter,'none');
  assert.equal(restored.px,'48');
  assert.equal(restored.renderer,'legacy');
  // Manual native16 outside PC-98 must still behave like native16.
  await $('video-font-render').selectOption('native16');
  assert.equal(await $('video-font-px').isDisabled(),true);
  await $('video-font-render').selectOption('legacy');
  assert.equal(await $('video-font-px').isDisabled(),false);
  console.log('PASS PC-98 grays only font px, disables input, preserves grid, restores prior settings, version v0.3.37');
}finally{await browser.close();}
