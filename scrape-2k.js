/* GoatLab - NBA 2K27 ratings grab (v3: + classic/all-time era "Prime" cards).
   Run in the Console (F12) on a www.2kratings.com tab. Crawls all 30 current team rosters,
   a list of retired legends, and every classic/all-time team roster (era Prime cards for the
   reel's rare PRIME pull), then downloads ballers-raw.json.
   CLASSICS_ONLY=true skips the slow current-roster/legends re-scrape (still scans the 30 roster
   pages for slug dedup) and downloads just ballers-classics-raw.json instead - fetch-ballers.js
   reads classics from either file. */
(async () => {
  const CLASSICS_ONLY = true;   // set false for a FULL re-grab (current rosters + legends + classics, ~15 min)
  const TEAMS=["atlanta-hawks","boston-celtics","brooklyn-nets","charlotte-hornets","chicago-bulls","cleveland-cavaliers","dallas-mavericks","denver-nuggets","detroit-pistons","golden-state-warriors","houston-rockets","indiana-pacers","los-angeles-clippers","los-angeles-lakers","memphis-grizzlies","miami-heat","milwaukee-bucks","minnesota-timberwolves","new-orleans-pelicans","new-york-knicks","oklahoma-city-thunder","orlando-magic","philadelphia-76ers","phoenix-suns","portland-trail-blazers","sacramento-kings","san-antonio-spurs","toronto-raptors","utah-jazz","washington-wizards"];
  // Retired greats for the Legends tier (bare slug = their all-time card when they have no current one).
  const LEGENDS=["michael-jordan","kobe-bryant","magic-johnson","larry-bird","shaquille-oneal","tim-duncan","hakeem-olajuwon","wilt-chamberlain","bill-russell","kareem-abdul-jabbar","julius-erving","oscar-robertson","jerry-west","kevin-garnett","dirk-nowitzki","allen-iverson","charles-barkley","scottie-pippen","patrick-ewing","david-robinson","john-stockton","karl-malone","isiah-thomas","dwyane-wade","paul-pierce","ray-allen","vince-carter","tracy-mcgrady","steve-nash","gary-payton","reggie-miller","clyde-drexler","dominique-wilkins","pete-maravich","moses-malone","george-gervin","james-worthy","dennis-rodman","manu-ginobili","tony-parker","yao-ming","ben-wallace","grant-hill","alonzo-mourning","kevin-mchale","robert-parish","elgin-baylor","bob-cousy","willis-reed","carmelo-anthony"];
  const ATTRS=[["Close Shot","closeShot"],["Mid-Range Shot","midRangeShot"],["Three-Point Shot","threePointShot"],["Free Throw","freeThrow"],["Layup","layup"],["Standing Dunk","standingDunk"],["Driving Dunk","drivingDunk"],["Post Control","postControl"],["Pass Accuracy","passAccuracy"],["Pass Vision","passVision"],["Pass IQ","passIQ"],["Ball Handle","ballHandle"],["Speed With Ball","speedWithBall"],["Interior Defense","interiorDefense"],["Perimeter Defense","perimeterDefense"],["Steal","steal"],["Block","block"],["Speed","speed"],["Agility","agility"],["Strength","strength"],["Vertical","vertical"],["Stamina","stamina"],["Offensive Rebound","offensiveRebound"],["Defensive Rebound","defensiveRebound"],["Shot IQ","shotIQ"],["Offensive Consistency","offensiveConsistency"],["Defensive Consistency","defensiveConsistency"],["Help Defense IQ","helpDefenseIQ"],["Intangibles","intangibles"]];
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  const EXCLUDE=/(^\/teams)|(-filter)|(-policy$)|(-generator$)|(-picker$)|(^\/compare)|(^\/guess)|(^\/subscribe)|(^\/random)|(^\/best-)|(^\/top-)|(-teams$)|(^\/lists)|(^\/badges)|(all-time)|(all-decade)|(classic)|(free-agency)|(^\/about)|(^\/contact)|(^\/privacy)|(^\/current)|(^\/nba-)|(^\/fiba)|(^\/g-league)|(^\/wnba)|(^\/mynba)|(^\/attributes)/i;
  // Same nav-junk blocklist but WITHOUT the classic/all-time exclusions - era player slugs contain those words.
  const CEXCLUDE=/(^\/teams)|(-filter)|(-policy$)|(-generator$)|(-picker$)|(^\/compare)|(^\/guess)|(^\/subscribe)|(^\/random)|(^\/best-)|(^\/top-)|(-teams$)|(^\/lists)|(^\/badges)|(all-decade)|(free-agency)|(^\/about)|(^\/contact)|(^\/privacy)|(^\/current)|(^\/nba-)|(^\/fiba)|(^\/g-league)|(^\/wnba)|(^\/mynba)|(^\/attributes)/i;
  const isPlayer=p=>/^\/[a-z0-9]+(?:-[a-z0-9]+)+$/.test(p)&&!EXCLUDE.test(p);
  const isClassicPlayer=p=>/^\/[a-z0-9]+(?:-[a-z0-9]+)+$/.test(p)&&!CEXCLUDE.test(p);
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
  // 1) current rosters -> player slugs (also needed in CLASSICS_ONLY mode, to tell era pages from current ones)
  console.log("Step 1/4 - scanning 30 team rosters...");
  const slugs=new Set();
  for(const t of TEAMS){ const html=await fetchText("/teams/"+t);
    if(html){ const doc=new DOMParser().parseFromString(html,"text/html"); for(const a of doc.querySelectorAll("a")){ const raw=a.getAttribute("href"); if(!raw) continue; let p; try{ p=new URL(raw,location.origin).pathname; }catch(e){ continue; } if(isPlayer(p)) slugs.add(p); } }
    console.log("  "+t+" -> unique so far: "+slugs.size); await sleep(110);
  }
  const players=[],failed=[];
  if(!CLASSICS_ONLY){
    console.log("Found "+slugs.size+" players. Step 2/4 - fetching each (keep this tab focused)...");
    let done=0,first=true;
    for(const p of slugs){ const html=await fetchText(p); const rec=html?parsePlayer(html,p):null;
      if(rec) players.push(rec); else failed.push(p);
      if(first&&rec){ first=false; console.log("First player parsed - sanity check:",rec); }
      if(++done%25===0) console.log("  "+done+"/"+slugs.size+" - "+players.length+" parsed"); await sleep(140);
    }
  } else console.log("CLASSICS_ONLY - skipping step 2/4 (current players).");
  // 3) legends
  const legends=[];
  if(!CLASSICS_ONLY){
    console.log("Step 3/4 - fetching "+LEGENDS.length+" legends...");
    let lg=0;
    for(const slug of LEGENDS){ const html=await fetchText("/"+slug); const rec=html?parsePlayer(html,"/"+slug):null;
      if(rec){ rec.legend=true; legends.push(rec); } if(++lg%15===0) console.log("  legends "+lg+"/"+LEGENDS.length+" - "+legends.length+" parsed"); await sleep(140);
    }
  } else console.log("CLASSICS_ONLY - skipping step 3/4 (legends).");
  // 4) classic + all-time team rosters -> era "Prime" cards
  console.log("Step 4/4 - classic & all-time teams (era Prime cards)...");
  const teamPaths=new Set();
  for(const ix of ["/teams/classic","/teams/all-time","/classic-teams","/all-time-teams","/teams",""]){
    const html=await fetchText(ix||"/"); if(!html) continue;
    const doc=new DOMParser().parseFromString(html,"text/html");
    for(const a of doc.querySelectorAll("a")){ const raw=a.getAttribute("href"); if(!raw) continue; let p; try{ p=new URL(raw,location.origin).pathname; }catch(e){ continue; }
      if(/^\/teams\/[a-z0-9-]+$/.test(p)&&!/all-decade|all-star|free-agency/.test(p)&&(/(19|20)\d{2}-\d{2}/.test(p)||/all-time/.test(p))) teamPaths.add(p);
    }
    await sleep(120);
  }
  console.log("  found "+teamPaths.size+" classic/all-time team pages");
  // era team name from the slug ("/teams/2012-13-miami-heat" -> "2012-13 Miami Heat") - steadier than page titles
  const slugTeamName=tp=>tp.replace(/^\/teams\//,"").replace(/-/g," ").replace(/(\d{4}) (\d{2,4})\b/,"$1-$2").replace(/\b[a-z]/g,c=>c.toUpperCase());
  const cands=new Map();   // slug -> {eraTeam, allTime}
  for(const tp of teamPaths){ const html=await fetchText(tp); if(!html) continue;
    const doc=new DOMParser().parseFromString(html,"text/html");
    const allTime=/all-time/.test(tp), teamName=slugTeamName(tp);
    let anchors=[...doc.querySelectorAll("table a")]; if(!anchors.length) anchors=[...doc.querySelectorAll("a")];
    for(const a of anchors){ const raw=a.getAttribute("href"); if(!raw) continue; let p; try{ p=new URL(raw,location.origin).pathname; }catch(e){ continue; }
      if(!isClassicPlayer(p)||slugs.has(p)||cands.has(p)) continue;
      // roster rows list the card's OVR among their numbers, so the row max can never sit below the
      // real OVR - safe to prefilter obvious low cards and only fetch the strong ones (85+ w/ buffer)
      const tr=a.closest("tr"); let rowMax=null;
      if(tr){ const nums=(tr.textContent.match(/\b\d{2,3}\b/g)||[]).map(Number).filter(n=>n<=130); if(nums.length) rowMax=Math.max(...nums); }
      if(rowMax!=null&&rowMax<84) continue;
      cands.set(p,{eraTeam:teamName,allTime});
    }
    console.log("  "+tp+" -> candidates so far: "+cands.size); await sleep(110);
  }
  console.log("  fetching "+cands.size+" era player pages...");
  const classics=[]; let cd=0,cfirst=true;
  for(const [p,info] of cands){ const html=await fetchText(p); const rec=html?parsePlayer(html,p):null;
    if(rec&&(rec.overall||0)>=84){ rec.eraTeam=rec.team||info.eraTeam; if(!rec.team) rec.team=info.eraTeam; rec.allTime=info.allTime; classics.push(rec);
      if(cfirst){ cfirst=false; console.log("First era card parsed - sanity check:",rec); } }
    if(++cd%25===0) console.log("  classics "+cd+"/"+cands.size+" - "+classics.length+" kept"); await sleep(140);
  }
  console.log("DONE: "+players.length+" players, "+legends.length+" legends, "+classics.length+" era cards.");
  const payload=CLASSICS_ONLY?{classics}:{players,legends,classics};
  const fname=CLASSICS_ONLY?"ballers-classics-raw.json":"ballers-raw.json";
  const blob=new Blob([JSON.stringify(payload)],{type:"application/json"}); const a=document.createElement("a"); a.href=URL.createObjectURL(blob); a.download=fname; document.body.appendChild(a); a.click(); a.remove();
  console.log("Downloaded "+fname+" - replace/put it in C:/Users/mattw/build-a-pitcher and tell me.");
  return {players:players.length,legends:legends.length,classics:classics.length};
})();
