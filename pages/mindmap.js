/* ══════════════════════════════════════════════════════════════
   mindmap.js  —  SocialProof Explore
   Architecture:
   · Full graph fetched once on load, cached in memory
   · Local state only during interaction (no API on drag/hover)
   · Progress batched: written on panel close + page unload
   · Media (image/youtube) optional per node — graceful absent
   · "Suggest a node" modal -> POST /api/mindmap/suggestions
══════════════════════════════════════════════════════════════ */

const MAP_ID   = 'main';
const API_BASE = '';

/* ══════════════════════════════════════════════════════════════
   FALLBACK GRAPH  (shown immediately; overwritten by API data)
══════════════════════════════════════════════════════════════ */
const FALLBACK_NODES = [
  { id:'root',type:'root',icon:'📰',label:'Viral Post',sub:'tap to investigate',x:1800,y:1500,startVisible:true,color:'#4488ff' },
  { id:'angry_spreads',type:'cat',icon:'😡',label:'Why Angry Posts Spread',x:1220,y:1120,color:'#ff3b3b',revealedBy:['root'] },
  { id:'who_shared',type:'cat',icon:'🔁',label:'Who Shared This First',x:2380,y:1120,color:'#38d4d4',revealedBy:['root'] },
  { id:'why_trust',type:'cat',icon:'🤔',label:'Why Do People Trust This',x:1800,y:920,color:'#9b6eff',revealedBy:['root'] },
  { id:'why_spread',type:'cat',icon:'📡',label:'Why Did This Spread',x:1220,y:1880,color:'#f5b731',revealedBy:['root'] },
  { id:'ragebait',type:'leaf',icon:'🎣',label:'Ragebait',x:820,y:860,color:'#ff3b3b',revealedBy:['angry_spreads'] },
  { id:'emotional_language',type:'leaf',icon:'🔥',label:'Emotional Language',x:780,y:1140,color:'#ff7a30',revealedBy:['angry_spreads'] },
  { id:'rec_algo',type:'cat',icon:'🤖',label:'Recommendation Algorithms',x:1020,y:1580,color:'#2fd469',revealedBy:['angry_spreads','why_spread'] },
  { id:'influencer_psych',type:'leaf',icon:'⭐',label:'Influencer Psychology',x:2680,y:900,color:'#38d4d4',revealedBy:['who_shared'] },
  { id:'bot_networks',type:'cat',icon:'🤖',label:'Bot Networks',x:2720,y:1200,color:'#e857c0',revealedBy:['who_shared'] },
  { id:'echo_chambers',type:'leaf',icon:'🔄',label:'Echo Chambers',x:2420,y:1400,color:'#4488ff',revealedBy:['who_shared'] },
  { id:'fake_image',type:'cat',icon:'🖼️',label:'Fake Image',x:1480,y:640,color:'#9b6eff',revealedBy:['why_trust'] },
  { id:'outrage_content',type:'leaf',icon:'💢',label:'Outrage Content',x:2120,y:640,color:'#ff7a30',revealedBy:['why_trust'] },
  { id:'humans_trust_faces',type:'leaf',icon:'👁️',label:'Why Humans Trust Faces',x:1800,y:560,color:'#9b6eff',revealedBy:['fake_image'] },
  { id:'filter_bubbles',type:'leaf',icon:'🫧',label:'Filter Bubbles',x:920,y:2080,color:'#f5b731',revealedBy:['rec_algo'] },
  { id:'addictive_feeds',type:'leaf',icon:'📱',label:'Addictive Feeds',x:1200,y:2220,color:'#ff7a30',revealedBy:['rec_algo'] },
  { id:'conspiracy_loops',type:'leaf',icon:'🌀',label:'Conspiracy Loops',x:720,y:1920,color:'#9b6eff',revealedBy:['rec_algo'] },
  { id:'deepfakes',type:'leaf',icon:'🎭',label:'Deepfakes',x:1180,y:440,color:'#e857c0',revealedBy:['fake_image'] },
  { id:'political_manipulation',type:'leaf',icon:'🗳️',label:'Political Manipulation',x:1480,y:380,color:'#ff3b3b',revealedBy:['fake_image'] },
  { id:'comment_war',type:'cat',icon:'💬',label:'Comment War',x:2680,y:1500,color:'#e857c0',revealedBy:['bot_networks'] },
  { id:'mob_mentality',type:'leaf',icon:'👥',label:'Mob Mentality',x:2920,y:1380,color:'#ff7a30',revealedBy:['comment_war','bot_networks'] },
  { id:'polarization',type:'leaf',icon:'↔️',label:'Polarization',x:2880,y:1620,color:'#ff3b3b',revealedBy:['comment_war'] },
  { id:'astroturfing',type:'leaf',icon:'🌿',label:'Astroturfing',x:2160,y:1880,color:'#2fd469',revealedBy:['bot_networks','manufactured_consensus'] },
  { id:'source_laundering',type:'leaf',icon:'🧺',label:'Source Laundering',x:1560,y:240,color:'#38d4d4',revealedBy:['fake_image','political_manipulation'] },
  { id:'screenshot_proof',type:'leaf',icon:'📸',label:'Screenshot as Proof',x:540,y:1300,color:'#f5b731',revealedBy:['emotional_language','ragebait'] },
  { id:'manufactured_consensus',type:'cat',icon:'🎭',label:'Manufactured Consensus',x:2480,y:1720,color:'#e857c0',revealedBy:['echo_chambers','bot_networks'] },
  { id:'firehose',type:'leaf',icon:'🚿',label:'Firehose of Falsehood',x:480,y:1560,color:'#ff3b3b',revealedBy:['angry_spreads','rec_algo'] },
  { id:'illusory_truth',type:'leaf',icon:'🔁',label:'Illusory Truth Effect',x:960,y:700,color:'#9b6eff',revealedBy:['why_trust','rec_algo'] },
  { id:'bandwagon',type:'leaf',icon:'🎡',label:'Bandwagon Effect',x:2160,y:400,color:'#4488ff',revealedBy:['who_shared','influencer_psych'] },
  { id:'sealioning',type:'leaf',icon:'🦭',label:'Sealioning',x:2980,y:1100,color:'#38d4d4',revealedBy:['bot_networks','comment_war'] },
];

/* ══════════════════════════════════════════════════════════════
   INTERACTIONS  — widget logic stays in JS (UI concern)
   media: { type: 'image'|'youtube', url: '...' }  — optional
══════════════════════════════════════════════════════════════ */
const INTERACTIONS = {

  root: {
    icon:'📰', title:'Viral Post',
    context:'This post has been shared 47,000 times in 6 hours. Something made people keep clicking.',
    widget:{
      type:'choice',
      q:'Why do you think it spread so fast?',
      opts:[
        {text:'It confirmed what people already believed',value:'a'},
        {text:'It triggered strong emotions',value:'b'},
        {text:'A celebrity shared it',value:'c'},
        {text:'The headline was shocking',value:'d'},
      ],
      reveals:{
        a:'Confirmation bias is powerful — we share things that validate what we already think. But the emotional pull is what usually moves the finger first.',
        b:'Exactly. Emotional content — especially anger, fear, or outrage — spreads faster than neutral information. That\'s not an accident.',
        c:'Influence matters. But why did they share it? Something in the content triggered their audience too.',
        d:'Headlines are engineered. "Scientists study X" gets ignored. "They\'re HIDING this" gets 50,000 shares.',
      }
    },
    reveals:['angry_spreads','who_shared','why_trust','why_spread'],
  },

  angry_spreads: {
    icon:'😡', title:'Why Angry Posts Spread',
    context:'Two headlines. Same topic. Very different result.',
    widget:{
      type:'choice',
      q:'Which headline would you click first?',
      opts:[
        {text:'🔵  "Scientists publish new climate report"',value:'neutral'},
        {text:'🔴  "They\'re LYING to you about climate"',value:'angry'},
      ],
      reveals:{
        neutral:'Most people clicked the other one. Outrage makes the brain feel like something is urgent and personal. Neutral facts don\'t trigger that response.',
        angry:'You\'re not alone — 74% of people clicked this in studies. Anger signals threat. Threat demands attention. Attention drives clicks.',
      }
    },
    aftermath:'Most users clicked B. Engagement spikes when emotion increases. The algorithm noticed.',
    reveals:['ragebait','emotional_language','rec_algo','firehose'],
  },

  rec_algo: {
    icon:'🤖', title:'Recommendation Algorithms',
    context:'The algorithm doesn\'t care about truth. It cares about one thing: how long you stay.',
    widget:{
      type:'slider',
      q:'Drag to maximize watch time:',
      leftLabel:'MORE TRUTH',
      rightLabel:'MORE WATCH TIME',
      feedStates:[
        {level:0,posts:[
          {text:'📊 New study: Exercise reduces anxiety by 48%',cls:'normal'},
          {text:'🌍 City council approves bike lane expansion',cls:'normal'},
          {text:'🎵 Local musician releases debut album',cls:'normal'},
        ]},
        {level:1,posts:[
          {text:'😤 Why your doctor isn\'t telling you the full truth',cls:'mild'},
          {text:'🚨 This common food is destroying your gut (SHARE)',cls:'mild'},
          {text:'📊 New study: Exercise reduces anxiety by 48%',cls:'normal'},
        ]},
        {level:2,posts:[
          {text:'🚨 THEY\'RE PUTTING SOMETHING IN THE WATER',cls:'extreme'},
          {text:'😱 What mainstream media WON\'T show you about vaccines',cls:'extreme'},
          {text:'😤 Why your doctor isn\'t telling you the full truth',cls:'mild'},
        ]},
      ]
    },
    aftermath:'Your feed became more engaging — and less reliable.',
    reveals:['filter_bubbles','addictive_feeds','conspiracy_loops','illusory_truth','firehose'],
  },

  fake_image: {
    icon:'🖼️', title:'Fake Image',
    context:'This image went viral. "Proof," people called it. But something is off.',
    widget:{
      type:'tap',
      q:'Find what feels suspicious. Tap on it.',
      items:[
        {id:'shadows',label:'👆 Shadows',x:'20%',y:'30%',w:70,h:50,hint:'Light sources don\'t match — two different images stitched together.'},
        {id:'fingers',label:'👆 Fingers',x:'65%',y:'60%',w:70,h:50,hint:'AI image generators still struggle with hands. Count carefully.'},
        {id:'text',label:'👆 Text',x:'40%',y:'75%',w:80,h:40,hint:'Background text is distorted and illegible — a classic AI artifact.'},
      ],
      display:'🖼️🤖',
      aftermath:'This image was AI-generated. The shadows, fingers, and background text all gave it away — but most people shared it anyway.'
    },
    reveals:['deepfakes','humans_trust_faces','political_manipulation','source_laundering'],
  },

  bot_networks: {
    icon:'🤖', title:'Bot Networks',
    context:'This post got 900 comments in 20 minutes. Scroll through them.',
    widget:{
      type:'bots',
      q:'Which accounts might be bots? Select them.',
      comments:[
        {id:'c1',avatar:'😊',name:'sarah_k',text:'I actually disagree — the study had major methodological flaws.',isBot:false},
        {id:'c2',avatar:'🇺🇸',name:'FREEDOM_NOW_1776',text:'SHARE THIS EVERYWHERE!! They don\'t want you to see this!!',isBot:true,reason:'All-caps urgency, posting every 3 minutes'},
        {id:'c3',avatar:'💪',name:'patriot_truth_88',text:'SHARE THIS EVERYWHERE!! They don\'t want you to see this!!',isBot:true,reason:'Identical copy-paste — coordinated behavior'},
        {id:'c4',avatar:'🎭',name:'user_19284',text:'Interesting perspective but I\'d want to see the primary sources.',isBot:false},
        {id:'c5',avatar:'🚨',name:'WakeUpAmerica99',text:'This is why we can\'t trust ANYONE anymore. RT if you agree.',isBot:true,reason:'Generic call-to-action, account created last week'},
        {id:'c6',avatar:'📚',name:'dr_helen_m',text:'As a researcher in this field, the framing here omits context.',isBot:false},
      ]
    },
    reveals:['comment_war','mob_mentality','astroturfing','manufactured_consensus','sealioning'],
  },

  comment_war: {
    icon:'💬', title:'Comment War',
    context:'Two sides, thousands of replies, zero resolution. Watch what happens.',
    widget:{
      type:'choice',
      q:'What\'s the most likely outcome of this comment war?',
      opts:[
        {text:'Someone changes their mind',value:'a'},
        {text:'Both sides become more extreme',value:'b'},
        {text:'The post gets fact-checked',value:'c'},
        {text:'It dies down naturally',value:'d'},
      ],
      reveals:{
        a:'Almost never happens online. Public arguments trigger identity defense — people dig in, not out.',
        b:'Correct. Research shows exposure to opposing views in hostile comment sections makes people more extreme, not less.',
        c:'Fact-checks do exist — but they typically reach 1/60th of the audience that saw the original claim.',
        d:'Sort of — but only after the damage is done. The original claim has already spread far beyond this thread.',
      }
    },
    reveals:['mob_mentality','polarization','sealioning'],
  },

  who_shared: {
    icon:'🔁', title:'Who Shared This First',
    context:'The first 200 shares determine whether a post lives or dies. Who were they?',
    widget:{
      type:'choice',
      q:'What\'s the most common origin of viral misinformation?',
      opts:[
        {text:'Random users with no agenda',value:'a'},
        {text:'Coordinated bot accounts',value:'b'},
        {text:'Influential accounts with large followings',value:'c'},
        {text:'Local community groups',value:'d'},
      ],
      reveals:{
        a:'Sometimes — but random virality is rarer than it looks. Most viral misinformation has a push.',
        b:'Bots amplify, but rarely originate. The first shares often come from real accounts with real beliefs.',
        c:'Often. MIT research found that verified, influential accounts spread false news further than any bot network — because we trust them.',
        d:'Groups are powerful amplifiers — but they\'re usually the second wave, not the origin.',
      }
    },
    reveals:['influencer_psych','bot_networks','echo_chambers','bandwagon'],
  },

  why_trust: {
    icon:'🤔', title:'Why People Trust This',
    context:'It has no sources. The numbers are vague. Yet thousands believe it.',
    widget:{
      type:'choice',
      q:'What makes a claim feel credible online?',
      opts:[
        {text:'It has citations and sources',value:'a'},
        {text:'It confirms something I already suspected',value:'b'},
        {text:'Someone I follow shared it',value:'c'},
        {text:'It has a confident, authoritative tone',value:'d'},
      ],
      reveals:{
        a:'This should matter most — but studies show most people never click sources even when they exist.',
        b:'This is the strongest predictor. Prior belief is more powerful than evidence. Our brains seek confirmation.',
        c:'Social proof is a huge trust signal. If your friend shared it, it passed their filter, so we lower ours.',
        d:'Tone matters more than we admit. Misinformation often copies the language of authority: statistics, formal phrasing, urgency.',
      }
    },
    reveals:['fake_image','outrage_content','illusory_truth'],
  },

  why_spread: {
    icon:'📡', title:'Why It Spread',
    context:'The post wasn\'t boosted by any official account. It spread because of system design.',
    widget:{
      type:'choice',
      q:'Which metric do social platforms prioritize most?',
      opts:[
        {text:'Accuracy of content',value:'a'},
        {text:'Time spent on the platform',value:'b'},
        {text:'User wellbeing',value:'c'},
        {text:'Diversity of perspectives',value:'d'},
      ],
      reveals:{
        a:'Platforms have accuracy labels and fact-check partnerships — but these are secondary. The primary metric has always been engagement.',
        b:'Correct. Watch time and daily active users drive advertising revenue. Outrage is good for watch time. So outrage gets amplified.',
        c:'Some platforms now say they optimize for "meaningful social interaction" — but the metrics they report to advertisers tell a different story.',
        d:'Research shows platforms actively reduce diversity over time as recommendation engines converge on what keeps each individual engaged.',
      }
    },
    reveals:['rec_algo'],
  },

  ragebait: {
    icon:'🎣', title:'Ragebait',
    context:'Content engineered specifically to provoke anger — not to inform.',
    widget:{
      type:'choice',
      q:'What\'s the goal of ragebait?',
      opts:[
        {text:'To start important conversations',value:'a'},
        {text:'To maximize engagement through outrage',value:'b'},
      ],
      reveals:{
        a:'Sometimes people justify it this way — but the design intent is engagement, not dialogue.',
        b:'Exactly. Angry people click, comment, and share. The platform rewards it. So creators make more of it.',
      }
    },
    reveals:['screenshot_proof'],
  },

  emotional_language: {
    icon:'🔥', title:'Emotional Language',
    context:'Words like "shocking," "exposed," "they don\'t want you to know" — they\'re signals.',
    widget:{
      type:'choice',
      q:'Which headline feels more trustworthy?',
      opts:[
        {text:'"Researchers find correlation between sleep and memory"',value:'a'},
        {text:'"SHOCKING: What sleep deprivation is REALLY doing to your brain"',value:'b'},
      ],
      reveals:{
        a:'This one is probably more accurate — and it will get a fraction of the clicks.',
        b:'All-caps emotional language is a red flag. It\'s designed to bypass critical thinking by triggering emotional response first.',
      }
    },
    reveals:['screenshot_proof'],
  },

  influencer_psych: {
    icon:'⭐', title:'Influencer Psychology',
    context:'When someone we admire shares something, our skepticism drops. That\'s by design.',
    widget:{
      type:'choice',
      q:'Why do we trust influencer content more than random posts?',
      opts:[
        {text:'They research everything they share',value:'a'},
        {text:'Social trust transfers from the person to their content',value:'b'},
      ],
      reveals:{
        a:'Research suggests most influencers share content based on what resonates emotionally, not factual verification.',
        b:'Exactly. Parasocial relationships make us extend trust to content we\'d otherwise question. It\'s the human halo effect.',
      }
    },
    reveals:['bandwagon'],
  },

  echo_chambers: {
    icon:'🔄', title:'Echo Chambers',
    context:'Your feed shows you what you already believe. You\'re not seeing the whole internet.',
    widget:{
      type:'choice',
      q:'What breaks an echo chamber?',
      opts:[
        {text:'Following people who disagree with you',value:'a'},
        {text:'Engaging with diverse media sources',value:'b'},
        {text:'Being aware it exists',value:'c'},
        {text:'All of these help, but none are guaranteed',value:'d'},
      ],
      reveals:{
        a:'This can help — but research shows that on adversarial platforms, exposure to opposing views can actually increase polarization.',
        b:'More effective than social media alone. Deliberately seeking out different publications and formats helps.',
        c:'Awareness is the first step. But even people who know about echo chambers still live inside them.',
        d:'Correct. Echo chambers are structural, not just psychological. Breaking them takes sustained, deliberate effort.',
      }
    },
    reveals:['manufactured_consensus'],
  },

  filter_bubbles: {
    icon:'🫧', title:'Filter Bubbles',
    context:'Two people search the same topic. They see completely different results.',
    widget:{
      type:'choice',
      q:'You and your neighbour Google the same election candidate. Who sees the same results?',
      opts:[
        {text:'We see the same — it\'s the same search engine',value:'a'},
        {text:'We see different results based on our histories',value:'b'},
      ],
      reveals:{
        a:'Not quite. Search engines personalize results based on location, browsing history, and past searches. The internet you see is already a curated version.',
        b:'Exactly. Search results, social feeds, and even news sites adapt to each user\'s profile. Two people in the same city can have radically different information environments.',
      }
    },
    reveals:[],
  },

  addictive_feeds: {
    icon:'📱', title:'Addictive Feeds',
    context:'Infinite scroll, variable reward, no natural stopping point. It\'s a slot machine.',
    widget:{
      type:'choice',
      q:'You opened the app to check one thing. 47 minutes later you\'re still scrolling. What happened?',
      opts:[
        {text:'I have no self-control',value:'a'},
        {text:'The app was engineered to keep me there',value:'b'},
        {text:'The content was just that good',value:'c'},
      ],
      reveals:{
        a:'This is what platforms want you to think — that it\'s a personal failure. It makes you less likely to question the design.',
        b:'Correct. Variable reward schedules, infinite scroll with no natural stopping point, and autoplay are all deliberate design choices.',
        c:'Sometimes. But "good content" and "content engineered to create compulsion" look identical from inside the experience. That\'s the point.',
      }
    },
    reveals:[],
  },

  conspiracy_loops: {
    icon:'🌀', title:'Conspiracy Loops',
    context:'One conspiracy theory connects to another. Each answer creates three new questions.',
    widget:{
      type:'choice',
      q:'Someone shows you counter-evidence against a conspiracy theory. In a loop, this evidence becomes:',
      opts:[
        {text:'Proof the theory is wrong',value:'a'},
        {text:'Proof the cover-up goes deeper',value:'b'},
        {text:'An interesting data point to consider',value:'c'},
      ],
      reveals:{
        a:'In an open, falsifiable belief — yes. But conspiracy loops are designed to be unfalsifiable: any evidence against them gets reinterpreted as evidence for them.',
        b:'This is the loop. When a belief system treats all counter-evidence as confirmation, it becomes impossible to escape from within.',
        c:'This is the healthy response — and it\'s rare inside a loop. The loop works by making neutral consideration feel like betrayal.',
      }
    },
    reveals:[],
  },

  deepfakes: {
    icon:'🎭', title:'Deepfakes',
    context:'A video of someone saying something they never said. Indistinguishable to most viewers.',
    widget:{
      type:'choice',
      q:'A viral video shows a politician announcing something shocking. Before sharing, you should:',
      opts:[
        {text:'Check if major news outlets are reporting it',value:'a'},
        {text:'Look for the original source and upload date',value:'b'},
        {text:'Run it through a deepfake detection tool',value:'c'},
        {text:'All of the above — and still be uncertain',value:'d'},
      ],
      reveals:{
        a:'A good first step. Deepfakes rarely surface on mainstream outlets before the original has been debunked — but not always.',
        b:'Crucial. Deepfakes are often re-posted clips stripped of original context. Where did this first appear? Who uploaded it?',
        c:'These tools exist and improve constantly — but so do deepfakes. Detection is in an arms race with generation.',
        d:'Correct. Media literacy isn\'t a checklist you complete — it\'s ongoing uncertainty management.',
      }
    },
    reveals:[],
  },

  humans_trust_faces: {
    icon:'👁️', title:'Why Humans Trust Faces',
    context:'Faces trigger an ancient trust instinct. AI knows this.',
    widget:{
      type:'choice',
      q:'The same health claim — with a photo of a doctor\'s face vs. no photo. Which gets more trust?',
      opts:[
        {text:'Same trust — I evaluate the words, not the image',value:'a'},
        {text:'The face version — even if I know the photo might be unrelated',value:'b'},
      ],
      reveals:{
        a:'This is what most people believe about themselves. But controlled studies show adding a face increases trust ratings even when participants are told the image is stock photography.',
        b:'Accurate — and uncomfortable. The fusiform face area in our brains processes faces automatically before we consciously evaluate them.',
      }
    },
    reveals:[],
  },

  political_manipulation: {
    icon:'🗳️', title:'Political Manipulation',
    context:'Fabricated images of politicians surface every election cycle. Many are never corrected.',
    widget:{
      type:'choice',
      q:'A fake image spreads and is later debunked. What percentage of the original audience sees the correction?',
      opts:[
        {text:'About 50% — corrections travel almost as far',value:'a'},
        {text:'About 10–20% — most don\'t follow up',value:'b'},
        {text:'Less than 5% — corrections rarely catch the original',value:'c'},
      ],
      reveals:{
        a:'Studies consistently show this isn\'t the case. Corrections don\'t carry the same emotional charge as the original.',
        b:'Generous. Most research puts it much lower — and even those who see the correction often remember the original claim.',
        c:'Correct. MIT research found corrections typically reach 1/20th to 1/60th of the original audience. The lie travels fast. The truth travels slow.',
      }
    },
    reveals:['source_laundering'],
  },

  outrage_content: {
    icon:'💢', title:'Outrage Content',
    context:'Designed to provoke moral indignation. Shares 3× more than neutral content.',
    widget:{
      type:'choice',
      q:'You see a post that makes you furious. What\'s the best first move?',
      opts:[
        {text:'Share it immediately — others need to know',value:'a'},
        {text:'Comment your anger — hold them accountable',value:'b'},
        {text:'Wait. Check the source. Then decide.',value:'c'},
      ],
      reveals:{
        a:'This is exactly what outrage content is designed to trigger. By the time you\'ve clicked share, the content has already won.',
        b:'Your comment adds to engagement metrics even if it\'s critical. The algorithm can\'t tell the difference between outrage and approval.',
        c:'The pause is the intervention. Outrage narrows the window between stimulus and action. Inserting a delay — even 30 seconds — dramatically reduces impulsive amplification.',
      }
    },
    reveals:[],
  },

  mob_mentality: {
    icon:'👥', title:'Mob Mentality',
    context:'When everyone is angry at the same thing, individual judgment collapses.',
    widget:{
      type:'choice',
      q:'10,000 people are piling on one account. You think they might be partly right. You:',
      opts:[
        {text:'Join in — social proof suggests they\'re probably correct',value:'a'},
        {text:'Stay silent — speaking up feels dangerous',value:'b'},
        {text:'Say what you actually think',value:'c'},
      ],
      reveals:{
        a:'This is how mobs sustain themselves — each person using the previous person\'s participation as evidence it\'s justified.',
        b:'Most people do this. The silence is interpreted as agreement, which makes the mob look even more consensual than it is.',
        c:'The hardest option — and statistically rare. Nuance doesn\'t get the same algorithmic reach as outrage.',
      }
    },
    reveals:[],
  },

  polarization: {
    icon:'↔️', title:'Polarization',
    context:'The gap between groups widens. Nuance becomes impossible. Compromise feels like betrayal.',
    widget:{
      type:'choice',
      q:'After a year of heavy social media use, research shows your political views are likely to be:',
      opts:[
        {text:'More nuanced — exposure to more information',value:'a'},
        {text:'More extreme — the algorithm sorted you',value:'b'},
        {text:'Unchanged — I have my own opinions',value:'c'},
      ],
      reveals:{
        a:'Intuitive but wrong. More information doesn\'t produce more nuance when filtered through an engagement-maximizing algorithm.',
        b:'Research by NYU and other institutions consistently finds engagement-optimized platforms move users toward more extreme positions over time.',
        c:'This is how most people feel. But your information diet shapes what feels normal, what feels like a threat, and who feels like "your people."',
      }
    },
    reveals:[],
  },

  // ── NEW NODES ─────────────────────────────────────────────

  astroturfing: {
    icon:'🌿', title:'Astroturfing',
    context:'It looks like a grassroots movement. It isn\'t. Someone built it.',
    widget:{
      type:'choice',
      q:'A local Facebook group with 12,000 members is loudly opposing a new vaccine site. What\'s the fastest way to check if it\'s organic?',
      opts:[
        {text:'Count the members — large means real',value:'a'},
        {text:'Check when the accounts were created and how active they are elsewhere',value:'b'},
        {text:'Look for corporate or political funding behind the domain',value:'c'},
        {text:'B and C together — size means nothing',value:'d'},
      ],
      reveals:{
        a:'Size is the easiest metric to fake. Bots, purchased followers, and shell accounts inflate numbers trivially.',
        b:'Newly created accounts posting exclusively about one issue is a strong astroturfing signal. Real movements have diverse, older account histories.',
        c:'Many astroturfing campaigns are funded by industries with financial stakes. Domain registration records and org filings are public.',
        d:'Correct. The combination of account forensics and funding trails is the most reliable method. Scale is the last thing you should trust.',
      }
    },
    reveals:[],
  },

  source_laundering: {
    icon:'🧺', title:'Source Laundering',
    context:'Misinformation often enters the mainstream by hopping from fringe sites to legitimate-looking ones before hitting social media.',
    widget:{
      type:'choice',
      q:'A viral tweet cites "GlobalHealthReport.org" for a shocking statistic. You\'ve never heard of it. What do you check first?',
      opts:[
        {text:'Whether the statistic sounds plausible',value:'a'},
        {text:'When the website was created and who owns it',value:'b'},
        {text:'Whether the URL has ".org" — those are trustworthy',value:'c'},
        {text:'Whether the tweet has many likes',value:'d'},
      ],
      reveals:{
        a:'Plausibility is a trap. False claims are often designed to feel true. "Sounds right" is how confirmation bias scales.',
        b:'Correct. WHOIS records and domain creation dates often reveal that authoritative-looking sites were created days before the claim surfaced. This is source laundering.',
        c:'.org means nothing. Anyone can register .org for $10. The TLD tells you nothing about legitimacy.',
        d:'Likes compound the problem — social proof signals credibility regardless of whether any individual verified the claim.',
      }
    },
    reveals:[],
  },

  screenshot_proof: {
    icon:'📸', title:'Screenshot as Proof',
    context:'A screenshot of a news headline. A screenshot of a government website. A screenshot of a DM. None of them are proof of anything.',
    widget:{
      type:'choice',
      q:'Someone posts a screenshot showing a major news outlet with the headline "Vaccines Cause Cancer." What do you do?',
      opts:[
        {text:'Share it — it\'s a major outlet, it must be real',value:'a'},
        {text:'Go directly to that outlet\'s site and search for the headline',value:'b'},
        {text:'Check if other outlets are reporting it',value:'c'},
        {text:'B and C — screenshots are unverifiable alone',value:'d'},
      ],
      reveals:{
        a:'Screenshots can be edited in seconds. Source reputation doesn\'t transfer to a screenshot of that source.',
        b:'The fastest check. If the headline was real, it would be findable. If it returns nothing, the screenshot is fabricated.',
        c:'A genuine breaking story from a major outlet would generate immediate coverage. Silence is a signal.',
        d:'Correct. Screenshots require external verification. The image itself proves only that an image exists.',
      }
    },
    reveals:[],
  },

  manufactured_consensus: {
    icon:'🎭', title:'Manufactured Consensus',
    context:'"Everyone is saying it." But are they? Or does it just look that way?',
    widget:{
      type:'bots',
      q:'A claim about a politician has 4,000 supportive comments posted in 2 hours. Which accounts show signs of coordination?',
      comments:[
        {id:'m1',avatar:'🇺🇸',name:'PatriotVoice2024',text:'FINALLY someone is saying it. This is what they\'ve been hiding!',isBot:true,reason:'Account created 4 days ago, zero prior activity'},
        {id:'m2',avatar:'🏠',name:'karen_from_ohio',text:'I\'m just a regular person and even I can see this is wrong.',isBot:true,reason:'Identical phrasing found in 47 other accounts'},
        {id:'m3',avatar:'📚',name:'j_kellerman_prof',text:'The evidence here is thin. I\'d want to see primary sources.',isBot:false},
        {id:'m4',avatar:'🚨',name:'TRUTH_EXPOSED_NOW',text:'Share before they DELETE this!!',isBot:true,reason:'Urgency + deletion threat is a classic coordination signal'},
        {id:'m5',avatar:'☕',name:'simone_t',text:'Can someone link the actual document? I can\'t find it.',isBot:false},
        {id:'m6',avatar:'💊',name:'healthfreedom88',text:'I\'ve been researching this for years. Trust me.',isBot:false},
      ]
    },
    reveals:['astroturfing'],
  },

  firehose: {
    icon:'🚿', title:'Firehose of Falsehood',
    context:'Don\'t argue about one lie. Flood the zone with hundreds. Exhaust the fact-checkers.',
    widget:{
      type:'choice',
      q:'A state actor releases 40 contradictory claims in 24 hours. Some are true, some false, some impossible to verify. The goal is:',
      opts:[
        {text:'To spread accurate information quickly',value:'a'},
        {text:'To confuse the public about what\'s real',value:'b'},
        {text:'To overwhelm fact-checkers so nothing gets debunked',value:'c'},
        {text:'Both B and C — confusion is the product',value:'d'},
      ],
      reveals:{
        a:'The speed and contradiction make this impossible. You can\'t simultaneously release contradictory truths.',
        b:'When everything is uncertain, people fall back on pre-existing beliefs. Confusion benefits whoever people already trusted.',
        c:'Fact-checking is a finite resource. 40 claims require 40 investigations. 1 lie slips through for every 39 debunked.',
        d:'Correct. The firehose strategy was documented by RAND in 2016 studying Russian information operations. The goal is epistemic exhaustion, not persuasion.',
      }
    },
    reveals:[],
  },

  illusory_truth: {
    icon:'🔁', title:'Illusory Truth Effect',
    context:'You\'ve seen this claim before. That makes it feel more credible. That\'s the mechanism.',
    widget:{
      type:'choice',
      q:'You\'ve seen a statistic three times on different sites. You haven\'t verified it. It now feels:',
      opts:[
        {text:'Equally uncertain — repetition proves nothing',value:'a'},
        {text:'More likely to be true — if it\'s everywhere, someone checked it',value:'b'},
        {text:'Suspicious — coordinated amplification',value:'c'},
      ],
      reveals:{
        a:'Rationally correct — but not how brains work. Fluency (ease of processing) gets misread as truth. This has been replicated in dozens of studies.',
        b:'This is the illusory truth effect. Familiarity is processed as credibility. This is why repeating a false claim — even to debunk it — can make it stick harder.',
        c:'Could be. But most people don\'t have this reaction. The far more common response is B — and that\'s what makes repetition a reliable propaganda tool.',
      }
    },
    reveals:[],
  },

  bandwagon: {
    icon:'🎡', title:'Bandwagon Effect',
    context:'"Millions of people believe this." So it must be worth considering. Right?',
    widget:{
      type:'choice',
      q:'A health claim is believed by 70% of people in a poll. Does that make it more likely to be true?',
      opts:[
        {text:'Yes — majority belief usually reflects reality',value:'a'},
        {text:'No — popularity and truth are unrelated',value:'b'},
        {text:'Somewhat — consensus should raise the prior',value:'c'},
      ],
      reveals:{
        a:'The history of medicine is full of majority-held beliefs that were wrong (ulcers from stress, bloodletting as treatment). Majority opinion is a social fact, not an empirical one.',
        b:'Correct in principle. Truth is independent of belief. But the bandwagon effect is why "70% of people believe X" gets deployed as evidence — it short-circuits evaluation.',
        c:'Expert consensus is different from popular consensus. "Most epidemiologists believe X" carries evidential weight. "Most people believe X" does not — it reflects shared exposure, not shared verification.',
      }
    },
    reveals:[],
  },

  sealioning: {
    icon:'🦭', title:'Sealioning',
    context:'Endless "just asking questions" until the other person gives up. Bad faith dressed as good faith.',
    widget:{
      type:'choice',
      q:'Someone keeps asking you for one more source, one more study, one more clarification — but never engages with what you provide. This is:',
      opts:[
        {text:'Legitimate skepticism — they want to be sure',value:'a'},
        {text:'A sealioning tactic — the goal is exhaustion, not answers',value:'b'},
        {text:'Hard to tell — you should keep engaging',value:'c'},
      ],
      reveals:{
        a:'Legitimate skepticism looks different: it engages with evidence provided, updates on strong proof, and has a threshold of satisfaction. Sealioning never reaches a threshold.',
        b:'Correct. The tell is asymmetry: they demand endless proof but accept none. The purpose is to exhaust your time and signal to observers that you "couldn\'t answer."',
        c:'The tell is whether previous answers are acknowledged. If every answer is treated as if no answer was given, you\'re not in a good-faith exchange.',
      }
    },
    reveals:[],
  },

};

/* ══════════════════════════════════════════════════════════════
   STATE
══════════════════════════════════════════════════════════════ */
let NODES = []; // populated from API or fallback

const state = {
  discovered:        new Set(['root']),
  visible:           new Set(['root']),
  activeNode:        null,
  pendingProgress:   new Set(),   // nodes to sync on flush
  panX: 0, panY: 0,
  scale: 1,
  isPanning: false,
  panStartX: 0, panStartY: 0, panStartTX: 0, panStartTY: 0,
};

const mapRoot   = document.getElementById('map-root');
const svgEl     = document.getElementById('connections');
const nodeEls   = {};
const edgeEls   = {};

/* ══════════════════════════════════════════════════════════════
   API LAYER  — thin, fire-and-forget writes
══════════════════════════════════════════════════════════════ */
async function fetchGraph() {
  try {
    const res = await fetch(`${API_BASE}/api/mindmap/graph?map=${MAP_ID}`);
    if (!res.ok) throw new Error('API not ready');
    const data = await res.json();
    // Merge API node data with fallback — prefer API revealedBy only if non-empty,
    // otherwise fall back to hardcoded edges so the map still works before DB edges are seeded
    return data.nodes.map(apiNode => {
      const fb = FALLBACK_NODES.find(n => n.id === apiNode.id) || {};
      const revealedBy = (apiNode.revealedBy && apiNode.revealedBy.length)
        ? apiNode.revealedBy
        : (fb.revealedBy || []);
      // startVisible: DB defaults to false for all nodes, so trust fallback when API says false.
      // Root must always be visible — never let the DB accidentally hide it.
      const startVisible = apiNode.startVisible || fb.startVisible || (apiNode.id === 'root');
      return { ...fb, ...apiNode, revealedBy, startVisible };
    });
  } catch {
    return null; // use fallback
  }
}

async function fetchProgress() {
  const userId = localStorage.getItem('sp_user_id');
  if (!userId) return;
  try {
    const res = await fetch(`${API_BASE}/api/mindmap/progress?map=${MAP_ID}`, {
      credentials: 'include'
    });
    if (!res.ok) return;
    const { discovered } = await res.json();
    discovered.forEach(id => {
      state.discovered.add(id);
      state.visible.add(id);
    });
    rebuildVisibility();
  } catch { /* silent */ }
}

function flushProgress() {
  if (!state.pendingProgress.size) return;
  const userId = localStorage.getItem('sp_user_id');
  if (!userId) { state.pendingProgress.clear(); return; }
  const ids = [...state.pendingProgress];
  state.pendingProgress.clear();
  // Fire-and-forget — no await, no UI block
  fetch(`${API_BASE}/api/mindmap/progress`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ map_id: MAP_ID, node_ids: ids })
  }).catch(() => {});
}

window.addEventListener('pagehide', flushProgress);
window.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flushProgress();
});

/* ══════════════════════════════════════════════════════════════
   BUILD DOM
══════════════════════════════════════════════════════════════ */
function hexAlpha(hex, a) {
  const r = parseInt(hex.slice(1,3),16);
  const g = parseInt(hex.slice(3,5),16);
  const b = parseInt(hex.slice(5,7),16);
  return `rgba(${r},${g},${b},${a})`;
}

function buildNodes() {
  NODES.forEach(n => {
    const el = document.createElement('div');
    el.className = `node node-${n.type}`;
    el.id = `node-${n.id}`;
    el.style.left = n.x + 'px';
    el.style.top  = n.y + 'px';
    const color = n.color || '#4488ff';
    el.innerHTML = `
      <div class="node-body" style="
        background:${hexAlpha(color,0.08)};
        border-color:${hexAlpha(color,0.35)};
        box-shadow:0 0 24px ${hexAlpha(color,0.15)};
        color:${color};">
        <div class="node-icon">${n.icon}</div>
        <div class="node-label">${n.label}</div>
        ${n.sub ? `<div class="node-sub">${n.sub}</div>` : ''}
      </div>
      ${n.type !== 'root' ? '<div class="ghost-badge">?</div>' : ''}
    `;
    el.addEventListener('click', () => onNodeClick(n.id));
    mapRoot.appendChild(el);
    nodeEls[n.id] = el;
    // Re-apply correct visibility class based on current state (handles API rebuild over fallback)
    if (state.discovered.has(n.id)) {
      el.classList.add('discovered');
    } else if (state.visible.has(n.id)) {
      el.classList.add('ghost-visible');
    } else if (!n.startVisible) {
      el.classList.add('ghost');
    }
  });
  revealGhostNeighbors('root');
}

function buildEdges() {
  const revealMap = {};
  NODES.forEach(n => {
    (n.revealedBy || []).forEach(src => {
      if (!revealMap[src]) revealMap[src] = [];
      revealMap[src].push(n.id);
    });
  });
  Object.entries(revealMap).forEach(([src, targets]) => {
    targets.forEach(tgt => {
      const key = `${src}_${tgt}`;
      const line = document.createElementNS('http://www.w3.org/2000/svg','path');
      line.setAttribute('class','edge');
      line.setAttribute('id',`edge-${key}`);
      const srcNode = NODES.find(n => n.id === src);
      const tgtNode = NODES.find(n => n.id === tgt);
      const color = tgtNode?.color || '#4488ff';
      line.setAttribute('stroke', color);
      updateEdgePath(line, srcNode, tgtNode);
      svgEl.appendChild(line);
      edgeEls[key] = line;
    });
  });
}

function updateEdgePath(line, src, tgt) {
  if (!src || !tgt) return;
  const mx = (src.x + tgt.x) / 2;
  const my = (src.y + tgt.y) / 2;
  line.setAttribute('d', `M${src.x},${src.y} Q${mx},${my} ${tgt.x},${tgt.y}`);
}

function rebuildVisibility() {
  state.discovered.forEach(id => {
    const el = nodeEls[id];
    if (el) {
      el.classList.remove('ghost','ghost-visible');
      el.classList.add('discovered');
    }
    // Show their edges
    NODES.find(n => n.id === id)?.revealedBy?.forEach(src => {
      const key = `${src}_${id}`;
      if (edgeEls[key]) edgeEls[key].classList.add('visible');
    });
    revealGhostNeighbors(id);
  });
  updateProgress();
}

/* ══════════════════════════════════════════════════════════════
   VISIBILITY
══════════════════════════════════════════════════════════════ */
function revealGhostNeighbors(nodeId) {
  // Nodes that list nodeId in their revealedBy become ghost-visible (show as ?)
  NODES.forEach(n => {
    if ((n.revealedBy || []).includes(nodeId) && !state.visible.has(n.id) && !state.discovered.has(n.id)) {
      state.visible.add(n.id);
      const el = nodeEls[n.id];
      if (el) { el.classList.remove('ghost'); el.classList.add('ghost-visible'); }
    }
  });
  // Also support explicit reveals list in INTERACTIONS if present
  (INTERACTIONS[nodeId]?.reveals || []).forEach(rid => {
    if (!state.visible.has(rid) && !state.discovered.has(rid)) {
      state.visible.add(rid);
      const el = nodeEls[rid];
      if (el) { el.classList.remove('ghost'); el.classList.add('ghost-visible'); }
    }
  });
}

function discoverNode(nodeId) {
  if (state.discovered.has(nodeId)) return;
  state.discovered.add(nodeId);
  state.pendingProgress.add(nodeId); // queue for batch sync
  const el = nodeEls[nodeId];
  if (el) { el.classList.remove('ghost','ghost-visible'); el.classList.add('discovered'); }
  NODES.find(n => n.id === nodeId)?.revealedBy?.forEach(src => {
    const key = `${src}_${nodeId}`;
    if (edgeEls[key]) edgeEls[key].classList.add('visible');
  });
  revealGhostNeighbors(nodeId);
  updateProgress();
}

/* ══════════════════════════════════════════════════════════════
   NODE CLICK
══════════════════════════════════════════════════════════════ */
function onNodeClick(nodeId) {
  if (!state.visible.has(nodeId) && !state.discovered.has(nodeId) && nodeId !== 'root') return;
  discoverNode(nodeId);
  // Flush previous node's progress before switching
  if (state.activeNode && state.activeNode !== nodeId) flushProgress();
  state.activeNode = nodeId;
  Object.values(nodeEls).forEach(el => el.classList.remove('active'));
  if (nodeEls[nodeId]) nodeEls[nodeId].classList.add('active');
  Object.values(edgeEls).forEach(e => e.classList.remove('active-edge'));
  const node = NODES.find(n => n.id === nodeId);
  node?.revealedBy?.forEach(src => {
    const key = `${src}_${nodeId}`;
    if (edgeEls[key]) edgeEls[key].classList.add('active-edge');
  });
  NODES.forEach(n => {
    if (n.revealedBy?.includes(nodeId)) {
      const key = `${nodeId}_${n.id}`;
      if (edgeEls[key]) edgeEls[key].classList.add('active-edge');
    }
  });
  openPanel(nodeId);
  centerOn(node);
}

/* ══════════════════════════════════════════════════════════════
   PANEL
══════════════════════════════════════════════════════════════ */
function openPanel(nodeId) {
  const inter = INTERACTIONS[nodeId];
  if (!inter) return;

  document.getElementById('panel-icon').textContent  = inter.icon;
  document.getElementById('panel-title').textContent = inter.title;

  const body = document.getElementById('panel-body');
  body.innerHTML = '';

  // ── Optional media (image or YouTube) ────────────────────
  // Only rendered if inter.media exists and has a url/id.
  // Absent = nothing rendered, panel still looks great.
  if (inter.media) {
    const mediaEl = buildMedia(inter.media);
    if (mediaEl) body.appendChild(mediaEl);
  }

  // ── Context text ─────────────────────────────────────────
  if (inter.context) {
    const ctx = document.createElement('p');
    ctx.className = 'panel-context';
    ctx.textContent = inter.context;
    body.appendChild(ctx);
  }

  // ── Widget ───────────────────────────────────────────────
  if (inter.widget) body.appendChild(buildWidget(inter.widget, inter));

  // ── Nearby ───────────────────────────────────────────────
  const nearby = buildNearby(nodeId);
  if (nearby) body.appendChild(nearby);

  // ── Suggest a node footer ────────────────────────────────
  body.appendChild(buildSuggestFooter(nodeId));

  const panel = document.getElementById('panel');
  panel.classList.add('open');
  document.getElementById('canvas').classList.add('panel-open');
  document.getElementById('progress-strip').classList.add('panel-offset');
}

function closePanel() {
  flushProgress(); // batch write on every panel close
  document.getElementById('panel').classList.remove('open');
  document.getElementById('canvas').classList.remove('panel-open');
  document.getElementById('progress-strip').classList.remove('panel-offset');
  Object.values(edgeEls).forEach(e => e.classList.remove('active-edge'));
  Object.values(nodeEls).forEach(el => el.classList.remove('active'));
  state.activeNode = null;
}

/* ══════════════════════════════════════════════════════════════
   MEDIA BUILDER  — image or youtube, optional
══════════════════════════════════════════════════════════════ */
const YOUTUBE_PATTERN = /^[a-zA-Z0-9_-]{11}$/;
const ALLOWED_IMAGE_ORIGINS = [
  'https://upload.wikimedia.org',
  'https://images.unsplash.com',
  'https://i.imgur.com',
  'https://cdn.', // broad cdn prefix check
];

function isSafeImageUrl(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return false;
    return ALLOWED_IMAGE_ORIGINS.some(prefix => url.startsWith(prefix)) || u.hostname.endsWith('.cloudfront.net') || u.hostname.endsWith('.s3.amazonaws.com');
  } catch { return false; }
}

function buildMedia(media) {
  if (!media || !media.url) return null;

  const wrap = document.createElement('div');
  wrap.className = 'panel-media';

  if (media.type === 'youtube') {
    const videoId = media.url.trim();
    if (!YOUTUBE_PATTERN.test(videoId)) return null;
    const iframe = document.createElement('iframe');
    iframe.className = 'panel-media-youtube';
    iframe.src = `https://www.youtube-nocookie.com/embed/${videoId}?rel=0&modestbranding=1`;
    iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture';
    iframe.allowFullscreen = true;
    iframe.loading = 'lazy';
    iframe.title = 'Related video';
    wrap.appendChild(iframe);
    return wrap;
  }

  if (media.type === 'image') {
    // Accept any https URL — let browser handle broken images gracefully
    // For production add isSafeImageUrl(media.url) check
    const img = document.createElement('img');
    img.className = 'panel-media-img';
    img.src = media.url;
    img.alt = media.alt || 'Related image';
    img.loading = 'lazy';
    img.onerror = () => wrap.remove(); // silently remove on broken image
    if (media.caption) {
      const cap = document.createElement('div');
      cap.className = 'panel-media-caption';
      cap.textContent = media.caption;
      wrap.appendChild(img);
      wrap.appendChild(cap);
      return wrap;
    }
    wrap.appendChild(img);
    return wrap;
  }

  return null;
}

/* ══════════════════════════════════════════════════════════════
   WIDGET BUILDER
══════════════════════════════════════════════════════════════ */
function buildWidget(widget, inter) {
  const wrap = document.createElement('div');
  wrap.className = 'widget';

  const qEl = document.createElement('div');
  qEl.className = 'widget-q';
  qEl.textContent = widget.q;
  wrap.appendChild(qEl);

  if (widget.type === 'choice') {
    const opts = document.createElement('div');
    opts.className = 'widget-opts';
    const rev = document.createElement('div');
    rev.className = 'revelation';

    widget.opts.forEach(opt => {
      const btn = document.createElement('button');
      btn.className = 'opt-btn';
      btn.textContent = opt.text;
      btn.onclick = () => {
        if (rev.classList.contains('show')) return;
        opts.querySelectorAll('.opt-btn').forEach(b => b.classList.add('wrong'));
        btn.classList.remove('wrong');
        btn.classList.add('selected');
        rev.innerHTML = `<div class="revelation-text">${widget.reveals[opt.value]}</div>`;
        if (inter.aftermath) {
          rev.innerHTML += `<div class="revelation-text" style="opacity:.65;font-size:11px;margin-top:4px">${inter.aftermath}</div>`;
        }
        rev.classList.add('show');
        setTimeout(() => {
          const nb = wrap.closest('#panel-body')?.querySelector('.nearby-hint');
          if (nb) nb.classList.add('show');
        }, 600);
      };
      opts.appendChild(btn);
    });

    wrap.appendChild(opts);
    wrap.appendChild(rev);

  } else if (widget.type === 'slider') {
    const sw = document.createElement('div');
    sw.className = 'slider-wrap';
    const labels = document.createElement('div');
    labels.className = 'slider-labels';
    labels.innerHTML = `<span>${widget.leftLabel}</span><span>${widget.rightLabel}</span>`;
    const slider = document.createElement('input');
    slider.type = 'range'; slider.min = 0; slider.max = 100; slider.value = 0;
    const feed = document.createElement('div');
    feed.className = 'slider-feed';
    const rev = document.createElement('div');
    rev.className = 'revelation';
    if (inter.aftermath) rev.innerHTML = `<div class="revelation-text">${inter.aftermath}</div>`;

    function renderFeed(val) {
      const lvl = val < 33 ? 0 : val < 66 ? 1 : 2;
      feed.innerHTML = '';
      widget.feedStates[lvl].posts.forEach(p => {
        const el = document.createElement('div');
        el.className = `feed-post ${p.cls}`;
        el.textContent = p.text;
        feed.appendChild(el);
      });
      if (val > 50 && !rev.classList.contains('show')) {
        rev.classList.add('show');
        setTimeout(() => {
          const nb = wrap.closest('#panel-body')?.querySelector('.nearby-hint');
          if (nb) nb.classList.add('show');
        }, 600);
      }
    }
    slider.oninput = () => renderFeed(parseInt(slider.value));
    renderFeed(0);
    sw.appendChild(labels); sw.appendChild(slider); sw.appendChild(feed);
    wrap.appendChild(sw); wrap.appendChild(rev);

  } else if (widget.type === 'tap') {
    const imgWrap = document.createElement('div');
    imgWrap.className = 'tap-image';
    const content = document.createElement('div');
    content.className = 'tap-image-content';
    content.textContent = widget.display;
    imgWrap.appendChild(content);

    const found = new Set();
    const rev = document.createElement('div');
    rev.className = 'revelation';

    widget.items.forEach(item => {
      const zone = document.createElement('div');
      zone.className = 'tap-zone';
      zone.style.cssText = `left:${item.x};top:${item.y};width:${item.w}px;height:${item.h}px;`;
      zone.textContent = item.label;
      zone.onclick = () => {
        if (found.has(item.id)) return;
        found.add(item.id);
        zone.classList.add('found');
        zone.textContent = '✓';
        rev.innerHTML = `<div class="revelation-text"><strong>${item.label.replace('👆 ','')}</strong>: ${item.hint}</div>`;
        rev.classList.add('show');
        if (found.size >= widget.items.length) {
          rev.innerHTML = `<div class="revelation-text">${widget.aftermath}</div>`;
          setTimeout(() => {
            const nb = wrap.closest('#panel-body')?.querySelector('.nearby-hint');
            if (nb) nb.classList.add('show');
          }, 600);
        }
      };
      imgWrap.appendChild(zone);
    });
    wrap.appendChild(imgWrap); wrap.appendChild(rev);

  } else if (widget.type === 'bots') {
    const feed = document.createElement('div');
    feed.className = 'scroll-feed';
    const selected = new Set();
    const rev = document.createElement('div');
    rev.className = 'revelation';
    const checkBtn = document.createElement('button');
    checkBtn.className = 'opt-btn';
    checkBtn.textContent = '→ Reveal which are bots';

    widget.comments.forEach(c => {
      const el = document.createElement('div');
      el.className = 'comment';
      el.innerHTML = `
        <div class="comment-avatar">${c.avatar}</div>
        <div class="comment-text">
          <span class="comment-name">@${c.name}</span>
          ${c.text}
          <div class="bot-badge">🤖 BOT — ${c.reason || ''}</div>
        </div>`;
      el.onclick = () => {
        if (el.classList.contains('bot-revealed')) return;
        selected.has(c.id) ? (selected.delete(c.id), el.classList.remove('bot-selected'))
                           : (selected.add(c.id), el.classList.add('bot-selected'));
      };
      feed.appendChild(el);
    });

    checkBtn.onclick = () => {
      feed.querySelectorAll('.comment').forEach((el, i) => {
        const c = widget.comments[i];
        el.classList.remove('bot-selected');
        if (c.isBot) el.classList.add('bot-revealed');
      });
      const correct = [...selected].filter(id => widget.comments.find(c=>c.id===id)?.isBot).length;
      const bots = widget.comments.filter(c=>c.isBot).length;
      rev.innerHTML = `<div class="revelation-text">You found <strong>${correct}/${bots}</strong> bots. Look for: repeated phrasing, all-caps urgency, accounts created recently, zero original content.</div>`;
      rev.classList.add('show');
      setTimeout(() => {
        const nb = wrap.closest('#panel-body')?.querySelector('.nearby-hint');
        if (nb) nb.classList.add('show');
      }, 600);
    };
    wrap.appendChild(feed); wrap.appendChild(checkBtn); wrap.appendChild(rev);
  }

  return wrap;
}

/* ══════════════════════════════════════════════════════════════
   NEARBY HINT
══════════════════════════════════════════════════════════════ */
function buildNearby(nodeId) {
  const reveals = INTERACTIONS[nodeId]?.reveals || [];
  if (!reveals.length) return null;
  const wrap = document.createElement('div');
  wrap.className = 'nearby-hint';
  if (nodeId === 'root') wrap.classList.add('show');
  const label = document.createElement('div');
  label.className = 'nearby-label';
  label.textContent = 'Nearby to explore';
  wrap.appendChild(label);
  const tags = document.createElement('div');
  tags.className = 'nearby-tags';
  reveals.forEach(rid => {
    const rNode = NODES.find(n => n.id === rid);
    if (!rNode) return;
    const tag = document.createElement('div');
    tag.className = 'nearby-tag';
    tag.textContent = `${rNode.icon} ${rNode.label}`;
    tag.onclick = () => { closePanel(); setTimeout(() => onNodeClick(rid), 200); };
    tags.appendChild(tag);
  });
  wrap.appendChild(tags);
  return wrap;
}

/* ══════════════════════════════════════════════════════════════
   SUGGEST A NODE FOOTER
══════════════════════════════════════════════════════════════ */
function buildSuggestFooter(fromNodeId) {
  const footer = document.createElement('div');
  footer.className = 'suggest-footer';
  footer.innerHTML = `
    <button class="suggest-btn" id="suggest-open-btn">
      ✦ Suggest a node
    </button>`;
  footer.querySelector('#suggest-open-btn').onclick = () => openSuggestModal(fromNodeId);
  return footer;
}

function openSuggestModal(fromNodeId) {
  const existing = document.getElementById('suggest-modal');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'suggest-modal';
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal" style="max-width:460px">
      <div class="modal-title">
        Suggest a node
        <button class="modal-close" id="suggest-close">✕</button>
      </div>
      <p style="font-size:.82rem;color:var(--muted);line-height:1.6;margin-bottom:1.2rem;">
        Think something is missing from this map? Suggest it — admins review all suggestions and may add it to the graph.
      </p>
      <div class="form-group">
        <label class="form-label">Node label <span style="color:var(--red)">*</span></label>
        <input class="form-input" id="sg-label" placeholder="e.g. Motivated Reasoning" maxlength="100">
      </div>
      <div class="form-group">
        <label class="form-label">Why should this be here?</label>
        <textarea class="form-textarea" id="sg-reason" style="min-height:80px"
          placeholder="How does it relate to media literacy or misinformation? Which existing node does it connect to?"></textarea>
      </div>
      <div id="sg-error" class="form-error"></div>
      <div class="form-actions">
        <button class="btn" id="sg-cancel">Cancel</button>
        <button class="btn btn-primary" id="sg-submit">Submit suggestion</button>
      </div>
    </div>`;

  document.body.appendChild(overlay);
  setTimeout(() => overlay.classList.add('open'), 10);

  overlay.querySelector('#suggest-close').onclick  =
  overlay.querySelector('#sg-cancel').onclick       = () => closeSuggestModal();

  overlay.querySelector('#sg-submit').onclick = async () => {
    const label  = overlay.querySelector('#sg-label').value.trim();
    const reason = overlay.querySelector('#sg-reason').value.trim();
    const errEl  = overlay.querySelector('#sg-error');
    errEl.style.display = 'none';

    if (!label) { errEl.textContent = 'Please enter a label.'; errEl.style.display = 'block'; return; }

    const btn = overlay.querySelector('#sg-submit');
    btn.disabled = true;
    btn.textContent = 'Sending…';

    try {
      const res = await fetch(`${API_BASE}/api/mindmap/suggestions`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label, reason, connect_from_id: fromNodeId, map_id: MAP_ID })
      });
      if (!res.ok) throw new Error();
      closeSuggestModal();
      showToast('✦ Suggestion sent — thanks!');
    } catch {
      btn.disabled = false;
      btn.textContent = 'Submit suggestion';
      errEl.textContent = 'Couldn\'t send right now. Try again.';
      errEl.style.display = 'block';
    }
  };
}

function closeSuggestModal() {
  const m = document.getElementById('suggest-modal');
  if (m) m.remove();
}

/* ══════════════════════════════════════════════════════════════
   PROGRESS
══════════════════════════════════════════════════════════════ */
function updateProgress() {
  const total = NODES.length;
  const found = state.discovered.size;

  if (found === total) {
    document.getElementById('progress-text').textContent = `All ${total} nodes discovered ✦`;
    document.getElementById('progress-text').style.color = 'var(--blue)';
  } else {
    document.getElementById('progress-text').textContent = `${found} of ${total} discovered`;
  }

  const dots = document.getElementById('progress-dots');
  dots.innerHTML = '';
  for (let i = 0; i < Math.min(total, 30); i++) {
    const d = document.createElement('div');
    d.className = 'progress-dot' + (i < found ? ' lit' : '');
    dots.appendChild(d);
  }

  if (found > 1) {
    const lastNode = NODES.find(n => n.id === state.activeNode);
    if (lastNode) showToast(`+ ${lastNode.icon} ${lastNode.label}`);
  }
}

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 2200);
}

/* ══════════════════════════════════════════════════════════════
   PAN & ZOOM
══════════════════════════════════════════════════════════════ */
const canvas = document.getElementById('canvas');

function applyTransform() {
  mapRoot.style.transform = `translate(${state.panX}px,${state.panY}px) scale(${state.scale})`;
}

function centerOn(node, offset = true) {
  if (!node) return;
  const cw = canvas.clientWidth, ch = canvas.clientHeight;
  const targetX = cw/2 - node.x * state.scale - (offset ? -80 : 0);
  const targetY = ch/2 - node.y * state.scale;
  const startX = state.panX, startY = state.panY;
  const startT = performance.now(), dur = 500;
  function step(now) {
    const t = Math.min((now - startT) / dur, 1);
    const ease = t < .5 ? 2*t*t : -1+(4-2*t)*t;
    state.panX = startX + (targetX - startX) * ease;
    state.panY = startY + (targetY - startY) * ease;
    applyTransform();
    if (t < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

function zoomToFit() {
  closePanel();
  const rootNode = NODES.find(n => n.id === 'root');
  state.scale = 0.9;
  centerOn(rootNode, false);
}

canvas.addEventListener('mousedown', e => {
  if (e.target.closest('.node,.opt-btn,input,.tap-zone,.comment,button')) return;
  state.isPanning = true;
  state.panStartX = e.clientX; state.panStartY = e.clientY;
  state.panStartTX = state.panX; state.panStartTY = state.panY;
  canvas.classList.add('panning');
});
window.addEventListener('mousemove', e => {
  if (!state.isPanning) return;
  state.panX = state.panStartTX + e.clientX - state.panStartX;
  state.panY = state.panStartTY + e.clientY - state.panStartY;
  applyTransform();
});
window.addEventListener('mouseup', () => { state.isPanning = false; canvas.classList.remove('panning'); });
canvas.addEventListener('wheel', e => {
  e.preventDefault();
  const factor = e.deltaY > 0 ? 0.92 : 1.08;
  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left, my = e.clientY - rect.top;
  const newScale = Math.min(2, Math.max(0.35, state.scale * factor));
  const sd = newScale / state.scale;
  state.panX = mx - (mx - state.panX) * sd;
  state.panY = my - (my - state.panY) * sd;
  state.scale = newScale;
  applyTransform();
}, { passive: false });

let lastTouches = null, lastPinchDist = null;
canvas.addEventListener('touchstart', e => {
  lastTouches = [...e.touches]; state.panStartTX = state.panX; state.panStartTY = state.panY;
  if (e.touches.length === 2) lastPinchDist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
}, { passive: true });
canvas.addEventListener('touchmove', e => {
  if (e.touches.length === 1 && lastTouches?.length === 1) {
    state.panX += e.touches[0].clientX - lastTouches[0].clientX;
    state.panY += e.touches[0].clientY - lastTouches[0].clientY;
    applyTransform();
  } else if (e.touches.length === 2 && lastPinchDist) {
    const dist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
    const factor = dist / lastPinchDist;
    const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
    const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
    const rect = canvas.getBoundingClientRect();
    const mx = midX - rect.left, my = midY - rect.top;
    const newScale = Math.min(2, Math.max(0.35, state.scale * factor));
    const sd = newScale / state.scale;
    state.panX = mx - (mx - state.panX) * sd;
    state.panY = my - (my - state.panY) * sd;
    state.scale = newScale;
    applyTransform();
    lastPinchDist = dist;
  }
  lastTouches = [...e.touches];
}, { passive: true });

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closePanel();
  if ((e.key === 'h' || e.key === 'H') && !e.target.matches('input,textarea')) zoomToFit();
});
document.getElementById('panel-close').addEventListener('click', closePanel);

/* ══════════════════════════════════════════════════════════════
   SIDEBAR (unchanged from original)
══════════════════════════════════════════════════════════════ */
const _sidebar = document.getElementById('sidebar');
const _overlay = document.getElementById('sidebar-overlay');
const _burgerBtn = document.getElementById('burger-btn');
let _sidebarOpen = window.innerWidth >= 900;
function initSidebar() {
  if (window.innerWidth < 900) { _sidebar.classList.add('collapsed'); _burgerBtn.classList.add('visible'); _sidebarOpen = false; }
  else { _sidebar.classList.remove('collapsed'); _burgerBtn.classList.remove('visible'); _sidebarOpen = true; }
}
function toggleSidebar() {
  _sidebarOpen = !_sidebarOpen;
  if (_sidebarOpen) { _sidebar.classList.remove('collapsed'); if (window.innerWidth < 900) _overlay.classList.add('visible'); _burgerBtn.classList.remove('visible'); }
  else { _sidebar.classList.add('collapsed'); _overlay.classList.remove('visible'); _burgerBtn.classList.add('visible'); }
}
window.addEventListener('resize', initSidebar);
initSidebar();

(function restoreAgePill() {
  const saved = localStorage.getItem('sp_age_mode') || 'adult';
  document.querySelectorAll('.age-pill').forEach(el => el.classList.remove('active'));
  const pill = document.getElementById('age-' + saved);
  if (pill) pill.classList.add('active');
  document.body.classList.toggle('mode-youth', saved === 'youth');
  document.body.classList.toggle('mode-older', saved === 'older');
})();
function setAgeMode(mode) {
  localStorage.setItem('sp_age_mode', mode);
  document.querySelectorAll('.age-pill').forEach(el => el.classList.remove('active'));
  const pill = document.getElementById('age-' + mode);
  if (pill) pill.classList.add('active');
  document.body.classList.toggle('mode-youth', mode === 'youth');
  document.body.classList.toggle('mode-older', mode === 'older');
}
(function authSidebar() {
  const username  = localStorage.getItem('sp_username');
  const loginLink = document.getElementById('sidebar-login-link');
  if (!loginLink) return;
  if (username) {
    loginLink.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>Log out`;
    loginLink.href = '#'; loginLink.style.color = 'var(--red)';
    loginLink.onclick = async e => {
      e.preventDefault();
      await fetch('/auth/cookie-logout', { method:'POST', credentials:'include' }).catch(()=>{});
      localStorage.clear(); window.location.href = 'login.html';
    };
  }
})();

/* ══════════════════════════════════════════════════════════════
   INIT  — fetch graph → build → load user progress
══════════════════════════════════════════════════════════════ */
async function init() {
  // 1. Use fallback immediately so the map is usable with zero latency
  NODES = FALLBACK_NODES;
  buildNodes();
  buildEdges();

  const rootNode = NODES.find(n => n.id === 'root');
  state.scale = 0.9;
  centerOn(rootNode, false);
  updateProgress();

  // 2. Try API — full rebuild so admin edits (new nodes, edges, positions) are reflected
  const apiNodes = await fetchGraph();
  if (apiNodes && apiNodes.length) {
    NODES = apiNodes;
    mapRoot.querySelectorAll('.node').forEach(el => el.remove());
    svgEl.querySelectorAll('.edge').forEach(el => el.remove());
    Object.keys(nodeEls).forEach(k => delete nodeEls[k]);
    Object.keys(edgeEls).forEach(k => delete edgeEls[k]);
    buildNodes();
    buildEdges();
    const root = NODES.find(n => n.id === 'root');
    if (root) centerOn(root, false);
    updateProgress();
  }

  // 3. Restore logged-in user's progress from DB
  await fetchProgress();
}

init();
