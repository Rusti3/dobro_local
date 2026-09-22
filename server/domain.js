import {createHmac,timingSafeEqual} from 'node:crypto';

/**
 * Validate MAX Bridge WebApp.initData according to the official MAX rules.
 * The client must send the value of window.WebApp.initData verbatim in
 * X-Max-Init-Data. initDataUnsafe is deliberately never trusted.
 */
export function maxUser(raw, token, now=Date.now()) {
 if(typeof raw !== 'string' || !token?.trim()) throw new Error('Откройте приложение из MAX ещё раз.');
 // Some bridge versions expose the complete URL-fragment wrapper. Accept it
 // while still validating the inner WebAppData string exactly as documented.
 if(raw.startsWith('WebAppData=')) {
   const wrapper=new URLSearchParams(raw);
   raw=wrapper.get('WebAppData') || '';
 }
 const pairs=raw.split('&').filter(Boolean).map(part=>{
   const at=part.indexOf('=');
   if(at<1) throw new Error('Некорректные данные запуска MAX.');
   return [part.slice(0,at),decodeURIComponent(part.slice(at+1))];
 });
 if(pairs.some(([key])=>key==='hash') && pairs.filter(([key])=>key==='hash').length!==1)
   throw new Error('Некорректная подпись MAX.');
 const hash=pairs.find(([key])=>key==='hash')?.[1];
 if(!hash || !/^[a-f0-9]{64}$/i.test(hash)) throw new Error('Откройте приложение из MAX ещё раз.');
 if(new Set(pairs.map(([key])=>key)).size!==pairs.length) throw new Error('Некорректные данные запуска MAX.');
 const q=new Map(pairs); q.delete('hash');
 const age=now/1000-Number(q.get('auth_date'));
 if(!Number.isFinite(age)||age < -30 || age > 3600) throw new Error('Сессия MAX истекла. Откройте приложение заново.');
 const data=[...q.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([key,value])=>`${key}=${value}`).join('\n');
 const secret=createHmac('sha256','WebAppData').update(token.trim()).digest();
 const expected=createHmac('sha256',secret).update(data).digest();
 const actual=Buffer.from(hash,'hex');
 if(actual.length!==expected.length || !timingSafeEqual(expected,actual)) throw new Error('Не удалось подтвердить MAX-сессию.');
 let u;
 try { u=JSON.parse(q.get('user')||'{}'); } catch { throw new Error('В данных MAX нет пользователя.'); }
 const id=String(u?.id ?? '');
 if(!/^\d+$/.test(id)||BigInt(id)<=0n) throw new Error('В данных MAX нет пользователя.');
 return {...u,id};
}

export function validatePlan(input,event,now=Date.now()) {
 if(!event||Date.parse(event.endsAt)<now) throw new Error('Событие завершилось. Выберите другое дело.');
 const when=input.when||null;
 if(when&&(!Number.isFinite(Date.parse(when))||Date.parse(when)<=now||Date.parse(when)<Date.parse(event.startsAt)||Date.parse(when)>Date.parse(event.endsAt))) throw new Error('Выберите будущую дату в периоде события.');
 return {when,meeting:String(input.meeting||'').trim().slice(0,240),mode:['friend','solo'].includes(input.mode)?input.mode:'friend',confirmed:!!input.confirmed};
}

export function validateRegistration(input = {}) {
 const name=String(input.name||'').trim().replace(/\s+/g,' ');
 const age=Number(input.age);
 if(name.length<2||name.length>60) throw new Error('Укажи имя длиной от 2 до 60 символов.');
 if(!Number.isInteger(age)||age<7||age>100) throw new Error('Укажи возраст от 7 до 100 лет.');
 return {name,age};
}

export function minimumEventAge(event) {
 const age=Number.parseInt(String(event?.age ?? ''),10);
 return Number.isFinite(age) ? age : null;
}

export function eventAllowedForUser(event,user) {
 const age=Number(user?.profile?.age);
 if(!user?.registered||!Number.isInteger(age)) return false;
 const quality=event?.annotation?.quality?.status;
 if(quality==='hidden'||quality==='human_review') return false;
 const minimum=minimumEventAge(event);
 return minimum===null||age>=minimum;
}

export function eligibleEvents(events,user) {
 return events.filter((event)=>eventAllowedForUser(event,user));
}
export function makeMessage(event) {return `Здравствуйте! Хочу впервые помочь: «${event.title}». Подскажите, пожалуйста, можно ли прийти новичку, какие будут задачи и сколько длится смена? Какую дату можно выбрать, что взять с собой, кто и где меня встретит? Можно ли прийти с другом? Есть ли ограничения по возрасту или здоровью?`;}
export function botReply(text,name='друг') {
 const cmd=text?.split(/[ @]/)[0];
 if(cmd==='/help') return 'хелпи помогает подготовить первый визит: выбрать дело, написать организатору, позвать друга и сохранить план. Запись на событие — у организатора. /garden — сад добрых дел, /plan — мой план, /stop — отключить напоминания, /delete — удалить мои данные.';
 if(cmd==='/stop') return 'Напоминания отключены. Можно вернуться в своём темпе.';
 return `Привет, ${name}! Начать помогать можно с одного небольшого шага. Подберём дело, подготовим вопросы организатору и позовём знакомого человека. Без рейтингов и обязательств. Открой мини-приложение ниже.`;
}
