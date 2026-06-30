/* GoatLab - NBA 2K27 ratings grab (v2: fuller attributes + Legends).
   Run in the Console (F12) on a www.2kratings.com tab. Crawls all 30 current team rosters,
   then a list of retired legends, reads each player's page, and downloads ballers-raw.json. */
(async () => {
  const TEAMS=["atlanta-hawks","boston-celtics","brooklyn-nets","charlotte-hornets","chicago-bulls","cleveland-cavaliers","dallas-mavericks","denver-nuggets","detroit-pistons","golden-state-warriors","houston-rockets","indiana-pacers","los-angeles-clippers","los-angeles-lakers","memphis-grizzlies","miami-heat","milwaukee-bucks","minnesota-timberwolves","new-orleans-pelicans","new-york-knicks","oklahoma-city-thunder","orlando-magic","philadelphia-76ers","phoenix-suns","portland-trail-blazers","sacramento-kings","san-antonio-spurs","toronto-raptors","utah-jazz","washington-wizards"];
  // Retired greats for the Legends tier (bare slug = their all-time card when they have no current one).
  const LEGENDS=["michael-jordan","kobe-bryant","magic-johnson","larry-bird","shaquille-oneal","tim-duncan","hakeem-olajuwon","wilt-chamberlain","bill-russell","kareem-abdul-jabbar","julius-erving","oscar-robertson","jerry-west","kevin-garnett","dirk-nowitzki","allen-iverson","charles-barkley","scottie-pippen","patrick-ewing","david-robinson","john-stockton","karl-malone","isiah-thomas","dwyane-wade","paul-pierce","ray-allen","vince-carter","tracy-mcgrady","steve-nash","gary-payton","reggie-miller","clyde-drexler","dominique-wilkins","pete-maravich","moses-malone","george-gervin","james-worthy","dennis-rodman","manu-ginobili","tony-parker","yao-ming","ben-wallace","grant-hill","alonzo-mourning","kevin-mchale","robert-parish","elgin-baylor","bob-cousy","willis-reed","carmelo-anthony"];
  const ATTRS=[["Close Shot","closeShot"],["Mid-Range Shot","midRangeShot"],["Three-Point Shot","threePointShot"],["Free Throw","freeThrow"],["Layup","layup"],["Standing Dunk","standingDunk"],["Driving Dunk","drivingDunk"],["Post Control","postControl"],["Pass Accuracy","passAccuracy"],["Pass Vision","passVision"],["Pass IQ","passIQ"],["Ball Handle","ballHandle"],["Speed With Ball","speedWithBall"],["Interior Defense","interiorDefense"],["Perimeter Defense","perimeterDefense"],["Steal","steal"],["Block","block"],["Speed","speed"],["Agility","agility"],["Strength","strength"],["Vertical","vertical"],["Stamina","stamina"],["Offensive Rebound","offensiveRebound"],["Defensive Rebound","defensiveRebound"],["Shot IQ","shotIQ"],["Offensive Consistency","offensiveConsistency"],["Defensive Consistency","defensiveConsistency"],["Help Defense IQ","helpDefenseIQ"],["Intangibles","intangibles"]];
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  const EXCLUDE=/(^\/teams)|(-filter)|(-policy$)|(-generator$)|(-picker$)|(^\/compare)|(^\/guess)|(^\/subscribe)|(^\/random)|(^\/best-)|(^\/top-)|(-teams$)|(^\/lists)|(^\/badges)|(all-time)|(all-decade)|(classic)|(free-agency)|(^\/about)|(^\/contact)|(^\/privacy)|(^\/current)|(^\/nba-)|(^\/fiba)|(^\/g-league)|(^\/wnba)|(^\/mynba)|(^\/attributes)/i;
  const isPlayer=p=>/^\/[a-z0-9]+(?:-[a-z0-9]+)+$/.test(p)&&!EXCLUDE.test(p);
  async function fetchText(url,tries=3){ for(let i=0;i<tries;i++){ try{ const r=await fetch(url); if(r.ok) return await r.text(); }catch(e){} await sleep(700*(i+1)); } return null; }
  const decode=s=>s.replace(/&amp;/g,"&").replace(/&#0?39;/g,"'").replace(/&apos;/g,"'").replace(/&quot;/g,'"').replace(/&#x27;/gi,"'");
  function parsePlayer(html,slug){
    const nameM=html.match(/<h1[^>]*>\s*([^<]+?)\s*<\/h1>/i); const name=nameM?decode(nameM[1]).trim():null; if(!name) return null;
    const lines=decode(html.replace(/<(script|style)[\s\S]*?<\/\1>/gi," ").replace(/<[^>]+>/g,"\n")).split("\n").map(s=>s.trim()).filter(Boolean);
    const flat=lines.join(" ");
    const valAfter=label=>{ for(let i=0;i<lines.length;i++){ if(lines[i].toLowerCase()===label.toLowerCase()){ for(let j=i+1;j<Math.min(i+3,lines.length);j++){ const m=lines[j].match(/^(\d{1,3})\b/); if(m) return +m[1]; } } } return null; };
    let overall=null; for(let i=1;i<lines.length;i++){ if(lines[i].toUpperCase()==="OVERALL"){ const m=lines[i-1].match(/^(\d{2,3})$/); if(m){ overall=+m[1]; break; } } }
    const hM=flat.match(/Height:\s*(\d+\s*'\s*\d+\s*")/), pM=flat.match(/Position:\s*([A-Za-z/ ]+?)\s+(?:Archetype|Height|Wingspan|Weight)/), tM=flat.match(/Team:\s*(.+?)\s+(?:Jersey|Position|Archetype|Height)/);
    const o={name,slug:slug.replace(/^\//,""),overall,position:pM?pM[1].trim():null,height:hM?hM[1].replace(/\s+/g,""):null,team:tM?tM[1].trim():null};
    let got=0; for(const pair of ATTRS){ const v=valAfter(pair[0]); o[pair[1]]=v; if(v!=null) got++; }
    return (overall==null||got<8)?null:o;
  }
  // 1) current rosters -> player slugs
  console.log("Step 1/3 - scanning 30 team rosters...");
  const slugs=new Set();
  for(const t of TEAMS){ const html=await fetchText("/teams/"+t);
    if(html){ const doc=new DOMParser().parseFromString(html,"text/html"); for(const a of doc.querySelectorAll("a")){ const raw=a.getAttribute("href"); if(!raw) continue; let p; try{ p=new URL(raw,location.origin).pathname; }catch(e){ continue; } if(isPlayer(p)) slugs.add(p); } }
    console.log("  "+t+" -> unique so far: "+slugs.size); await sleep(110);
  }
  console.log("Found "+slugs.size+" players. Step 2/3 - fetching each (keep this tab focused)...");
  const players=[],failed=[]; let done=0,first=true;
  for(const p of slugs){ const html=await fetchText(p); const rec=html?parsePlayer(html,p):null;
    if(rec) players.push(rec); else failed.push(p);
    if(first&&rec){ first=false; console.log("First player parsed - sanity check:",rec); }
    if(++done%25===0) console.log("  "+done+"/"+slugs.size+" - "+players.length+" parsed"); await sleep(140);
  }
  // 3) legends
  console.log("Step 3/3 - fetching "+LEGENDS.length+" legends...");
  const legends=[]; let lg=0;
  for(const slug of LEGENDS){ const html=await fetchText("/"+slug); const rec=html?parsePlayer(html,"/"+slug):null;
    if(rec){ rec.legend=true; legends.push(rec); } if(++lg%15===0) console.log("  legends "+lg+"/"+LEGENDS.length+" - "+legends.length+" parsed"); await sleep(140);
  }
  console.log("DONE: "+players.length+" players, "+legends.length+" legends.");
  const blob=new Blob([JSON.stringify({players,legends})],{type:"application/json"}); const a=document.createElement("a"); a.href=URL.createObjectURL(blob); a.download="ballers-raw.json"; document.body.appendChild(a); a.click(); a.remove();
  console.log("Downloaded ballers-raw.json - replace the old one in C:/Users/mattw/build-a-pitcher and tell me.");
  return {players:players.length,legends:legends.length};
})();
