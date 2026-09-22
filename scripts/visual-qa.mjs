import {chromium} from '@playwright/test';
import fs from 'node:fs';
fs.mkdirSync('test-results',{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true});
const errors=[];const page=await browser.newPage({viewport:{width:1440,height:1080}});
page.on('pageerror',e=>errors.push(e.message));
await page.goto('http://127.0.0.1:3210');await page.getByRole('heading',{name:'Можно начать вот с этого',exact:true}).waitFor();await page.screenshot({path:'test-results/home-desktop.png',fullPage:true});
await page.getByRole('navigation',{name:'Основная навигация'}).getByRole('button',{name:'Мой сад',exact:true}).click();await page.getByRole('heading',{name:'Сад добрых дел',exact:true}).waitFor();
await page.getByRole('button',{name:'Посмотреть пример сада'}).click();await page.getByRole('button',{name:'Дуб заботы: Помощь приюту'}).click();await page.getByRole('heading',{name:'Дуб заботы',exact:true}).waitFor();await page.screenshot({path:'test-results/garden-preview.png',fullPage:true});await page.getByRole('button',{name:'Вернуться в мой сад'}).click();
await page.getByRole('button',{name:'Найти дело',exact:true}).click();
await page.getByRole('button',{name:/Помочь кошкам найти дом/}).click();await page.getByRole('heading',{name:'Как сделать первый шаг'}).waitFor();await page.screenshot({path:'test-results/detail-desktop.png',fullPage:true});
await page.getByRole('button',{name:'Это мой первый шаг'}).click();await page.getByRole('heading',{name:'Мой первый выход'}).waitFor();await page.getByRole('button',{name:'Пригласить друга'}).click();await page.locator('textarea').waitFor();const link=await page.locator('textarea').inputValue();
const friend=await browser.newPage({viewport:{width:390,height:844}});await friend.goto(link);await friend.getByRole('button',{name:'Пойду вместе'}).click();await friend.getByRole('heading',{name:'Мой первый выход'}).waitFor();await friend.screenshot({path:'test-results/friend-mobile.png',fullPage:true});
await page.goto('http://127.0.0.1:3210/?tab=plan');await page.getByText('В компании: Друг.').waitFor();await page.screenshot({path:'test-results/plan-desktop.png',fullPage:true});
const mobile=await browser.newPage({viewport:{width:390,height:844}});await mobile.goto('http://127.0.0.1:3210');await mobile.getByRole('heading',{name:'Можно начать вот с этого',exact:true}).waitFor();await mobile.screenshot({path:'test-results/home-mobile.png',fullPage:true});
await mobile.getByRole('navigation',{name:'Мобильная навигация'}).getByRole('button',{name:'Мой сад',exact:true}).click();await mobile.getByRole('heading',{name:'Сад добрых дел',exact:true}).waitFor();
await mobile.getByRole('button',{name:'Посмотреть пример сада'}).click();if(await mobile.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw Error('Garden preview overflow');await mobile.screenshot({path:'test-results/garden-mobile.png',fullPage:true});await mobile.getByRole('button',{name:'Вернуться в мой сад'}).click();
for(const tab of ['Начать','Дела','Мой сад','Вместе','План']){await mobile.getByRole('navigation',{name:'Мобильная навигация'}).getByRole('button',{name:tab,exact:true}).click();await mobile.screenshot({path:`test-results/mobile-${tab}.png`,fullPage:true});if(await mobile.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw Error('Horizontal overflow: '+tab);}
if(errors.length)throw Error(errors.join('\n'));console.log('PASS: garden, preview, plant history, catalog, detail, plan, two-user invitation, persistence, mobile navigation; no JS errors or overflow.');await browser.close();
