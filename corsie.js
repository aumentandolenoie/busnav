/* Departure bays ("corsie") of the extra-urban and Colli lines, from the Busitalia
   table "Corsie" (Cod. linea · Linea · Corsia). Lines are matched like the ticket
   calculator (tickets.js): Academy line number → E0NN, Colli → A/AT/ATL/M/T/TL, market
   detours and lines without a number through the Academy evidence. Shown under the
   route name in step 3 of the web app, which iOS and Android also use. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.Corsie=api})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 // Sub-codes of the table (E003B, E005-V/Z, E013-V/Z, E015-V/Z, E019_1, E031_6,
 // E060-V/Z, E060_1, E066-Z, E071_6, E073_1) have the same bay as their line.
 const LINES={
  E001:4,E002:4,E003:1,E004:4,E005:4,E006:1,E007:5,E008:6,E009:6,E010:6,E011:6,E012:6,E013:6,
  E015:11,E016:6,E017:9,E018:9,E019:9,E020:9,E021:14,E026:8,E029:13,E031:8,E035:5,E036:13,
  E037:3,E038:13,E040:5,E041:3,E045:5,E060:3,E062:10,E063:10,E066:4,E071:7,E073:7,E074:14,
  E076:4,E080:8,
  A:11,AT:11,ATL:11,M:11,T:11,TL:11
 };
 // School trips: the table gives the bay of each institute too.
 const INSTITUTES=[
  [/\bIST(?:\.|ITUTO|ITUTI)?\s*VALLE\b/,'Ist. Valle',8],
  [/\bIST(?:\.|ITUTO|ITUTI)?\s*SEVERI\b/,'Ist. Severi',13],
  [/\bIST(?:\.|ITUTO|ITUTI)?\s*MARCONI\b/,'Ist. Marconi',10],
  [/\bIST(?:\.|ITUTO|ITUTI)?\s*MARCHESI\b|\bBOAGA\b/,'Ist. Marchesi/Boaga',13],
  [/\bIST(?:\.|ITUTO|ITUTI)?\s*VIA\s+CAVE\b/,'Istituti via Cave',14]
 ];
 const base=code=>{const m=/^E(\d{3})/.exec(String(code||''));return m?'E'+m[1]:String(code||'')};
 /** Line codes for an Academy route, with the ticket data when available. */
 function lineCodes(route,tickets){
  if(!route||/^(urban|navett|padova marathon)/i.test(String(route.category||'')))return [];
  if(tickets&&globalThis.Tickets)return globalThis.Tickets.suggestedLines(tickets,route).map(i=>base(tickets.lines[i].code));
  if(/^(urban|navett|padova marathon)/i.test(String(route.category||'')))return [];
  const line=String(route.line||'').trim().toUpperCase();
  if(/^\d{1,3}$/.test(line))return ['E'+line.padStart(3,'0')];
  return line in LINES?[line]:[];
 }
 /** {bays:[n…], institute:{name,bay}|null} for an Academy route. */
 function info(route,tickets){
  const bays=[...new Set(lineCodes(route,tickets).map(c=>LINES[c]).filter(Boolean))];
  const name=String(route?.name||'').toUpperCase();
  // The table lists extra-urban school trips: urban lines and shuttles have no bay.
  const hit=/^(extraurbano|colli)/i.test(String(route?.category||''))&&INSTITUTES.find(([re])=>re.test(name));
  return {bays,institute:hit?{name:hit[1],bay:hit[2]}:null};
 }
 /** "Corsia 11", "Corsia 5 o 14", "Corsia 13 · Ist. Valle: corsia 8", or "". */
 function label(route,tickets){
  const {bays,institute}=info(route,tickets);
  const parts=[];
  if(bays.length)parts.push('Corsia '+bays.slice(0,-1).join(', ')+(bays.length>1?' o ':'')+bays.at(-1));
  if(institute&&!(bays.length===1&&bays[0]===institute.bay))parts.push(institute.name+': corsia '+institute.bay);
  return parts.join(' · ');
 }
 return {LINES,info,label,lineCodes};
});
