/*!
 * Sky Peek weather backgrounds  -  13 weather types x 4 times of day, flat + animated.
 * No dependencies. Works in any modern browser (needs CSS container query units: Chrome 105+, Safari 16+, Firefox 110+).
 *
 *   const bg = SkyPeekWeather.mount(element, { time: 'evening', weather: 'rain' });
 *   bg.update({ weather: 'snow' });   // switch scene
 *   bg.destroy();                     // remove
 *
 * time:    'morning' | 'afternoon' | 'evening' | 'night' | 'local clock' | 'random'
 * weather: 'clear' | 'partly' | 'cloudy' | 'windy' | 'fog' | 'haze' | 'drizzle' | 'rain' |
 *          'sleet' | 'hail' | 'snow' | 'storm' | 'heat' | 'random'
 * The background fills `element` (give it a size and position: relative).
 */
(function (global) {
  'use strict';
  var CSS = "\n.sp-drift{animation-name:spDrift;animation-timing-function:linear;animation-iteration-count:infinite}\n.sp-fall{animation-name:spFall;animation-timing-function:linear;animation-iteration-count:infinite}\n.sp-snow{animation-name:spSnow;animation-timing-function:linear;animation-iteration-count:infinite}\n.sp-twinkle{animation-name:spTwinkle;animation-timing-function:ease-in-out;animation-iteration-count:infinite}\n.sp-pulse{animation:spPulse 6s ease-out infinite;transform-box:fill-box;transform-origin:center}\n.sp-spin{animation:spSpin 60s linear infinite;transform-box:fill-box;transform-origin:center}\n.sp-sway{animation-name:spSway;animation-timing-function:ease-in-out;animation-iteration-count:infinite;animation-direction:alternate}\n.sp-bob{animation:spBob 7s ease-in-out infinite alternate}\n.sp-flap{animation:spFlap .9s ease-in-out infinite alternate;transform-origin:center}\n.sp-flash{animation:spFlash 7s linear infinite}\n.sp-shoot{animation:spShoot 11s linear infinite}\n.sp-splash{animation-name:spSplash;animation-timing-function:ease-out;animation-iteration-count:infinite}\n.sp-wind{animation-name:spWind;animation-timing-function:linear;animation-iteration-count:infinite}\n.sp-leaf{animation-name:spLeaf;animation-timing-function:linear;animation-iteration-count:infinite}\n.sp-pellet{animation-name:spPellet;animation-timing-function:linear;animation-iteration-count:infinite}\n.sp-hail{animation-name:spHail;animation-timing-function:linear;animation-iteration-count:infinite}\n.sp-shimmer{animation-name:spShimmer;animation-timing-function:ease-in-out;animation-iteration-count:infinite}\n@keyframes spDrift{from{transform:translateX(-480px)}to{transform:translateX(calc(100cqw + 40px))}}\n@keyframes spFall{from{transform:translate(0,-20cqh) rotate(14deg)}to{transform:translate(-26cqh,120cqh) rotate(14deg)}}\n@keyframes spSnow{0%{transform:translate(0,-10cqh)}25%{transform:translate(14px,20cqh)}50%{transform:translate(-10px,50cqh)}75%{transform:translate(12px,80cqh)}100%{transform:translate(0,112cqh)}}\n@keyframes spTwinkle{0%,100%{opacity:.25}50%{opacity:1}}\n@keyframes spPulse{0%{transform:scale(1);opacity:.55}100%{transform:scale(1.5);opacity:0}}\n@keyframes spSpin{to{transform:rotate(360deg)}}\n@keyframes spSway{from{transform:translateX(-5%)}to{transform:translateX(5%)}}\n@keyframes spBob{from{transform:translate(-18px,0)}to{transform:translate(18px,-8px)}}\n@keyframes spFlap{from{transform:scaleY(1)}to{transform:scaleY(.35)}}\n@keyframes spFlash{0%,86%,89%,91%,100%{opacity:0}87%{opacity:.75}90%{opacity:.45}}\n@keyframes spShoot{0%,86%{transform:translate(0,0) rotate(-24deg);opacity:0}87%{opacity:1}93%{transform:translate(-360px,160px) rotate(-24deg);opacity:0}100%{transform:translate(-360px,160px) rotate(-24deg);opacity:0}}\n@keyframes spSplash{0%{transform:scale(.2);opacity:0}12%{opacity:.85}45%{transform:scale(1.4);opacity:0}100%{transform:scale(1.4);opacity:0}}\n@keyframes spWind{0%{transform:translateX(-40cqw);opacity:0}15%{opacity:.9}85%{opacity:.9}100%{transform:translateX(120cqw);opacity:0}}\n@keyframes spLeaf{0%{transform:translate(-10cqw,0) rotate(0deg)}25%{transform:translate(25cqw,-6cqh) rotate(160deg)}50%{transform:translate(55cqw,4cqh) rotate(320deg)}75%{transform:translate(85cqw,-3cqh) rotate(500deg)}100%{transform:translate(115cqw,5cqh) rotate(720deg)}}\n@keyframes spPellet{from{transform:translate(0,-15cqh) rotate(0deg)}to{transform:translate(-12cqh,118cqh) rotate(180deg)}}\n@keyframes spHail{0%{transform:translate(0,-10cqh);opacity:1}78%{transform:translate(-4cqh,80cqh);opacity:1}86%{transform:translate(-5cqh,73cqh);opacity:1}94%{transform:translate(-6cqh,80cqh);opacity:1}100%{transform:translate(-6cqh,80cqh);opacity:0}}\n@keyframes spShimmer{0%,100%{transform:translateX(-12px);opacity:.08}50%{transform:translateX(12px);opacity:.5}}\n@media (prefers-reduced-motion: reduce){.sp-anim{animation-play-state:paused !important}}\n";
  var TEMPLATE = "<div class=\"spw-root\" style=\"position: absolute; inset: 0; overflow: hidden; container-type: size; background: {{sky}}\">\n\n  <sc-if value=\"{{ showBands }}\" hint-placeholder-val=\"{{ false }}\">\n    <div aria-hidden=\"true\" style=\"position: absolute; left: 0; right: 0; bottom: 18%; height: 34%; background: {{band1}}\"></div>\n    <div aria-hidden=\"true\" style=\"position: absolute; left: 0; right: 0; bottom: 18%; height: 22%; background: {{band2}}\"></div>\n    <div aria-hidden=\"true\" style=\"position: absolute; left: 0; right: 0; bottom: 18%; height: 12%; background: {{band3}}\"></div>\n  </sc-if>\n\n  <sc-if value=\"{{ showStars }}\" hint-placeholder-val=\"{{ false }}\">\n    <div aria-hidden=\"true\" style=\"position: absolute; inset: 0\">\n      <sc-for list=\"{{ stars }}\" as=\"s\" hint-placeholder-count=\"0\">\n        <div class=\"sp-anim sp-twinkle\" style=\"position: absolute; left: {{s.x}}%; top: {{s.y}}%; width: {{s.r}}px; height: {{s.r}}px; border-radius: 50%; background: #FFFFFF; animation-duration: {{s.dur}}s; animation-delay: {{s.delay}}s\"></div>\n      </sc-for>\n      <sc-if value=\"{{ showShooting }}\" hint-placeholder-val=\"{{ false }}\">\n        <div class=\"sp-anim sp-shoot\" style=\"position: absolute; left: 62%; top: 10%; width: 110px; height: 2px; border-radius: 2px; background: #FFFFFF; opacity: 0\"></div>\n      </sc-if>\n    </div>\n  </sc-if>\n\n  <sc-if value=\"{{ showOrb }}\" hint-placeholder-val=\"{{ false }}\">\n    <svg aria-hidden=\"true\" viewBox=\"-150 -150 300 300\" style=\"position: absolute; left: {{orbX}}; top: {{orbY}}; width: 300px; height: 300px; transform: translate(-50%, -50%) scale({{orbScale}}); opacity: {{orbOpacity}}; overflow: visible\">\n      <defs>\n        <mask id=\"spMoonCut\"><rect x=\"-150\" y=\"-150\" width=\"300\" height=\"300\" fill=\"#FFFFFF\"></rect><circle cx=\"30\" cy=\"-18\" r=\"58\" fill=\"#000000\"></circle></mask>\n      </defs>\n      <circle class=\"sp-anim sp-pulse\" r=\"104\" fill=\"{{ring}}\"></circle>\n      <circle r=\"86\" fill=\"{{ring}}\" opacity=\"0.55\"></circle>\n      <sc-if value=\"{{ showRays }}\" hint-placeholder-val=\"{{ false }}\">\n        <g class=\"sp-anim sp-spin\" stroke=\"{{orb}}\" stroke-width=\"7\" stroke-linecap=\"round\">\n          <sc-for list=\"{{ rays }}\" as=\"r\" hint-placeholder-count=\"0\">\n            <line x1=\"{{r.x1}}\" y1=\"{{r.y1}}\" x2=\"{{r.x2}}\" y2=\"{{r.y2}}\"></line>\n          </sc-for>\n        </g>\n      </sc-if>\n      <sc-if value=\"{{ isNight }}\" hint-placeholder-val=\"{{ false }}\">\n        <circle r=\"62\" fill=\"{{orb}}\" mask=\"url(#spMoonCut)\"></circle>\n      </sc-if>\n      <sc-if value=\"{{ isDay }}\" hint-placeholder-val=\"{{ true }}\">\n        <circle r=\"62\" fill=\"{{orb}}\"></circle>\n      </sc-if>\n    </svg>\n  </sc-if>\n\n  <div aria-hidden=\"true\" style=\"position: absolute; inset: 0\">\n    <sc-for list=\"{{ farClouds }}\" as=\"c\" hint-placeholder-count=\"0\">\n      <div class=\"sp-anim sp-drift\" style=\"position: absolute; left: 0; top: {{c.y}}%; width: {{c.w}}px; animation-duration: {{c.dur}}s; animation-delay: {{c.delay}}s\">\n        <svg viewBox=\"0 0 200 110\" style=\"display: block; width: 100%; height: auto\"><path d=\"{{c.d}}\" fill=\"{{farCloud}}\"></path></svg>\n      </div>\n    </sc-for>\n  </div>\n\n  <sc-if value=\"{{ showDeck }}\" hint-placeholder-val=\"{{ false }}\">\n    <div aria-hidden=\"true\" class=\"sp-anim sp-sway\" style=\"position: absolute; left: -8%; width: 116%; top: 0; animation-duration: 28s\">\n      <svg viewBox=\"0 0 1440 220\" preserveAspectRatio=\"xMidYMin slice\" style=\"display: block; width: 100%; height: clamp(150px, 26cqh, 260px)\">\n        <path d=\"{{deckPath}}\" fill=\"{{deckShade}}\" transform=\"translate(0 12)\"></path>\n        <path d=\"{{deckPath}}\" fill=\"{{deck}}\"></path>\n      </svg>\n    </div>\n  </sc-if>\n\n  <div aria-hidden=\"true\" style=\"position: absolute; inset: 0\">\n    <sc-for list=\"{{ clouds }}\" as=\"c\" hint-placeholder-count=\"0\">\n      <div class=\"sp-anim sp-drift\" style=\"position: absolute; left: 0; top: {{c.y}}%; width: {{c.w}}px; animation-duration: {{c.dur}}s; animation-delay: {{c.delay}}s\">\n        <svg viewBox=\"0 0 200 110\" style=\"display: block; width: 100%; height: auto\"><path d=\"{{c.d}}\" fill=\"{{cloudShade}}\" transform=\"translate(0 8)\"></path><path d=\"{{c.d}}\" fill=\"{{cloud}}\"></path></svg>\n      </div>\n    </sc-for>\n  </div>\n\n  <sc-if value=\"{{ showParked }}\" hint-placeholder-val=\"{{ false }}\">\n    <div aria-hidden=\"true\" class=\"sp-anim sp-bob\" style=\"position: absolute; left: calc({{orbX}} - 170px); top: calc({{orbY}} - 4px); width: 280px\">\n      <svg viewBox=\"0 0 200 110\" style=\"display: block; width: 100%; height: auto\"><path d=\"{{parkedPath}}\" fill=\"{{cloudShade}}\" transform=\"translate(0 8)\"></path><path d=\"{{parkedPath}}\" fill=\"{{cloud}}\"></path></svg>\n    </div>\n  </sc-if>\n\n  <sc-if value=\"{{ showBirds }}\" hint-placeholder-val=\"{{ false }}\">\n    <div aria-hidden=\"true\" style=\"position: absolute; inset: 0\">\n      <sc-for list=\"{{ birds }}\" as=\"b\" hint-placeholder-count=\"0\">\n        <div class=\"sp-anim sp-drift\" style=\"position: absolute; left: 0; top: {{b.y}}%; width: {{b.w}}px; animation-duration: {{b.dur}}s; animation-delay: {{b.delay}}s\">\n          <svg class=\"sp-anim sp-flap\" viewBox=\"0 0 24 10\" style=\"display: block; width: 100%; height: auto; animation-delay: {{b.flap}}s\"><path d=\"M1 8 Q 6 1 12 7 Q 18 1 23 8\" fill=\"none\" stroke=\"{{bird}}\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"></path></svg>\n        </div>\n      </sc-for>\n    </div>\n  </sc-if>\n\n  <svg aria-hidden=\"true\" viewBox=\"0 0 1440 300\" preserveAspectRatio=\"none\" style=\"position: absolute; left: 0; bottom: 0; width: 100%; height: 30%\">\n    <path d=\"M0 80 C 160 40, 300 60, 420 70 S 640 30, 820 55 S 1100 40, 1260 60 S 1400 70, 1440 60 L 1440 300 L 0 300 Z\" fill=\"{{ridge}}\"></path>\n    <path d=\"M0 140 C 180 90, 360 100, 560 130 S 920 90, 1120 115 S 1360 140, 1440 125 L 1440 300 L 0 300 Z\" fill=\"{{hillFar}}\"></path>\n    <path d=\"M0 220 C 240 170, 480 205, 720 192 S 1180 160, 1440 205 L 1440 300 L 0 300 Z\" fill=\"{{hillNear}}\"></path>\n  </svg>\n\n  <sc-if value=\"{{ showFog }}\" hint-placeholder-val=\"{{ false }}\">\n    <div aria-hidden=\"true\" style=\"position: absolute; inset: 0\">\n      <div style=\"position: absolute; inset: 0; background: {{fogColor}}; opacity: {{veil}}\"></div>\n      <sc-for list=\"{{ fogBands }}\" as=\"f\" hint-placeholder-count=\"0\">\n        <div class=\"sp-anim sp-sway\" style=\"position: absolute; left: {{f.x}}%; width: {{f.w}}%; top: {{f.y}}%; height: {{f.h}}px; border-radius: 999px; background: {{fogColor}}; opacity: {{f.o}}; animation-duration: {{f.dur}}s; animation-delay: {{f.delay}}s\"></div>\n      </sc-for>\n    </div>\n  </sc-if>\n\n  <sc-if value=\"{{ showHeat }}\" hint-placeholder-val=\"{{ false }}\">\n    <div aria-hidden=\"true\" style=\"position: absolute; inset: 0\">\n      <sc-for list=\"{{ shimmer }}\" as=\"m\" hint-placeholder-count=\"0\">\n        <svg class=\"sp-anim sp-shimmer\" viewBox=\"0 0 240 14\" style=\"position: absolute; left: {{m.x}}%; top: {{m.y}}%; width: {{m.w}}px; height: auto; animation-duration: {{m.dur}}s; animation-delay: {{m.delay}}s\"><path d=\"M0 7 C 20 2, 40 2, 60 7 S 100 12, 120 7 S 160 2, 180 7 S 220 12, 240 7\" fill=\"none\" stroke=\"{{shimmerColor}}\" stroke-width=\"2\" stroke-linecap=\"round\"></path></svg>\n      </sc-for>\n    </div>\n  </sc-if>\n\n  <sc-if value=\"{{ showRain }}\" hint-placeholder-val=\"{{ false }}\">\n    <div aria-hidden=\"true\" style=\"position: absolute; inset: 0\">\n      <sc-for list=\"{{ drops }}\" as=\"d\" hint-placeholder-count=\"0\">\n        <div class=\"sp-anim sp-fall\" style=\"position: absolute; left: {{d.x}}%; top: 0; width: 2px; height: {{d.len}}px; border-radius: 1px; background: {{dropColor}}; opacity: {{d.o}}; animation-duration: {{d.dur}}s; animation-delay: {{d.delay}}s\"></div>\n      </sc-for>\n      <sc-for list=\"{{ splashes }}\" as=\"p\" hint-placeholder-count=\"0\">\n        <div class=\"sp-anim sp-splash\" style=\"position: absolute; left: {{p.x}}%; top: {{p.y}}%; width: {{p.w}}px; height: 4px; border-radius: 50%; background: {{dropColor}}; animation-duration: {{p.dur}}s; animation-delay: {{p.delay}}s\"></div>\n      </sc-for>\n    </div>\n  </sc-if>\n\n  <sc-if value=\"{{ showSnow }}\" hint-placeholder-val=\"{{ false }}\">\n    <div aria-hidden=\"true\" style=\"position: absolute; inset: 0\">\n      <sc-for list=\"{{ flakes }}\" as=\"k\" hint-placeholder-count=\"0\">\n        <div class=\"sp-anim sp-snow\" style=\"position: absolute; left: {{k.x}}%; top: 0; width: {{k.r}}px; height: {{k.r}}px; border-radius: 50%; background: #FFFFFF; opacity: {{k.o}}; animation-duration: {{k.dur}}s; animation-delay: {{k.delay}}s\"></div>\n      </sc-for>\n    </div>\n  </sc-if>\n\n  <sc-if value=\"{{ showIce }}\" hint-placeholder-val=\"{{ false }}\">\n    <div aria-hidden=\"true\" style=\"position: absolute; inset: 0\">\n      <sc-for list=\"{{ ice }}\" as=\"i\" hint-placeholder-count=\"0\">\n        <div class=\"sp-anim {{i.cls}}\" style=\"position: absolute; left: {{i.x}}%; top: 0; width: {{i.r}}px; height: {{i.r}}px; border-radius: {{i.round}}; background: #FFFFFF; box-shadow: 0 2px 0 {{iceShade}}; animation-duration: {{i.dur}}s; animation-delay: {{i.delay}}s\"></div>\n      </sc-for>\n    </div>\n  </sc-if>\n\n  <sc-if value=\"{{ showWind }}\" hint-placeholder-val=\"{{ false }}\">\n    <div aria-hidden=\"true\" style=\"position: absolute; inset: 0\">\n      <sc-for list=\"{{ streaks }}\" as=\"w\" hint-placeholder-count=\"0\">\n        <div class=\"sp-anim sp-wind\" style=\"position: absolute; left: 0; top: {{w.y}}%; width: {{w.w}}px; height: {{w.h}}px; border-radius: 3px; background: {{windColor}}; animation-duration: {{w.dur}}s; animation-delay: {{w.delay}}s\"></div>\n      </sc-for>\n      <sc-for list=\"{{ leaves }}\" as=\"l\" hint-placeholder-count=\"0\">\n        <div class=\"sp-anim sp-leaf\" style=\"position: absolute; left: 0; top: {{l.y}}%; width: {{l.w}}px; height: {{l.h}}px; border-radius: 0 100% 0 100%; background: {{l.c}}; animation-duration: {{l.dur}}s; animation-delay: {{l.delay}}s\"></div>\n      </sc-for>\n    </div>\n  </sc-if>\n\n  <sc-if value=\"{{ showStorm }}\" hint-placeholder-val=\"{{ false }}\">\n    <div aria-hidden=\"true\" class=\"sp-anim sp-flash\" style=\"position: absolute; inset: 0; background: #FFFFFF; opacity: 0\"></div>\n    <svg aria-hidden=\"true\" class=\"sp-anim sp-flash\" viewBox=\"0 0 60 140\" style=\"position: absolute; left: 22%; top: 14%; width: 58px; height: auto; opacity: 0\"><path d=\"M34 0 L6 76 L28 76 L16 140 L56 52 L32 52 L46 0 Z\" fill=\"#FFF3B8\"></path></svg>\n  </sc-if>\n</div>";
  var TIMES = ['morning', 'afternoon', 'evening', 'night'];
  var WEATHERS = ['clear', 'partly', 'cloudy', 'windy', 'fog', 'haze', 'drizzle', 'rain', 'sleet', 'hail', 'snow', 'storm', 'heat'];
  var LABELS = { clear: 'Clear', partly: 'Partly cloudy', cloudy: 'Cloudy', windy: 'Windy', fog: 'Fog', haze: 'Haze', drizzle: 'Drizzle', rain: 'Rain', sleet: 'Sleet', hail: 'Hail', snow: 'Snow', storm: 'Thunderstorm', heat: 'Heat' };

  function compute(opts) {

    var TIMES = ['morning', 'afternoon', 'evening', 'night'];
    var WEATHERS = ['clear', 'cloudy', 'rain', 'snow', 'storm', 'fog', 'partly', 'windy', 'drizzle', 'sleet', 'hail', 'haze', 'heat'];
    var _rand = {
        t: TIMES[Math.floor(Math.random() * TIMES.length)],
        w: WEATHERS[Math.floor(Math.random() * WEATHERS.length)]
      };
    var time = opts.time || 'random';
    var weather = opts.weather || 'random';
    if (time === 'random') time = _rand.t;
    if (time === 'local clock') {
      var hr = new Date().getHours();
      time = (hr < 5 || hr >= 20) ? 'night' : hr < 11 ? 'morning' : hr < 17 ? 'afternoon' : 'evening';
    }
    if (weather === 'random') weather = _rand.w;
    if (TIMES.indexOf(time) < 0) time = 'afternoon';
    if (WEATHERS.indexOf(weather) < 0) weather = 'clear';
    var night = time === 'night';
    var is = function () { return Array.prototype.indexOf.call(arguments, weather) >= 0; };

    var PAL = {
      morning: {
        sky: { clear: '#FBE1C6', partly: '#F6DDC8', cloudy: '#E8DAD0', windy: '#F8DFCA', fog: '#EFE6DE', haze: '#EBD5BA', drizzle: '#D9D0D0', rain: '#C8C4CB', sleet: '#C9C6CF', hail: '#A9A4B2', snow: '#DCD3D4', storm: '#A29DAB', heat: '#FBE5BE' },
        hills: ['#F2BE9F', '#E19F84'], snowHills: ['#FFFFFF', '#EADFDD'], hazeHills: ['#D9B79E', '#C49A82'], heatHills: ['#EBC18F', '#D9A06E'],
        cloud: '#FFF7EE', rainCloud: '#B4ACB4', stormCloud: '#827C8E', snowCloud: '#F6EFEC',
        orb: '#FFCF7A', ring: '#FDD8A8', hazeOrb: '#F4A866', hazeRing: '#F2CDA0', heatOrb: '#FFC94A', heatRing: '#FFE3A0',
        orbX: '18%', orbY: '52%', fog: '#FFFFFF', haze: '#F6E6D2', wind: '#FFFFFF', leaf: '#D9824F', leaf2: '#E8B04A', shimmer: '#D98E4E', bird: '#6B4A52'
      },
      afternoon: {
        sky: { clear: '#9CCDF2', partly: '#A6CBE8', cloudy: '#B7C6D3', windy: '#A9D0EE', fog: '#C9D4DC', haze: '#E2D3B5', drizzle: '#A3B1BE', rain: '#8E9DAC', sleet: '#9AA7B5', hail: '#66748A', snow: '#BCC9D6', storm: '#58667A', heat: '#F3E4B4' },
        hills: ['#A9D39B', '#7FB77E'], snowHills: ['#FFFFFF', '#DCE6F0'], hazeHills: ['#C9B994', '#AE9E7A'], heatHills: ['#E3C27A', '#C9A25A'],
        cloud: '#FFFFFF', rainCloud: '#7C8898', stormCloud: '#3F4A5C', snowCloud: '#EEF2F6',
        orb: '#FFE07A', ring: '#FFF0B8', hazeOrb: '#F0A050', hazeRing: '#F2D09C', heatOrb: '#FFC93A', heatRing: '#FFE58A',
        orbX: '78%', orbY: '22%', fog: '#FFFFFF', haze: '#EFE5CF', wind: '#FFFFFF', leaf: '#5E9A52', leaf2: '#9BC25A', shimmer: '#C98A2E', bird: '#2E4A66'
      },
      evening: {
        sky: { clear: '#F28C6B', partly: '#E9917A', cloudy: '#C99A92', windy: '#EE9478', fog: '#E3B7A6', haze: '#D9A47E', drizzle: '#B08A8F', rain: '#9E7F86', sleet: '#A08890', hail: '#62495E', snow: '#CBAFB1', storm: '#5A4358', heat: '#F7A56A' },
        hills: ['#B65A6D', '#7D3B5E'], snowHills: ['#F6E6E3', '#DCC4C6'], hazeHills: ['#B47E73', '#8E5B5C'], heatHills: ['#C9705A', '#9C4B4A'],
        cloud: '#FBC5A6', rainCloud: '#8A6C78', stormCloud: '#43303F', snowCloud: '#EBD3D0',
        orb: '#FFD79A', ring: '#FFB27A', hazeOrb: '#E9783E', hazeRing: '#F0A87A', heatOrb: '#FFD07A', heatRing: '#FFB560',
        orbX: '78%', orbY: '58%', fog: '#FFE7DC', haze: '#EFC7A6', wind: '#FFE3D4', leaf: '#8E2F45', leaf2: '#D9733F', shimmer: '#FFE0B8', bird: '#4A1E33'
      },
      night: {
        sky: { clear: '#121A3B', partly: '#151C38', cloudy: '#1B2238', windy: '#141B3A', fog: '#20283F', haze: '#2A2530', drizzle: '#191F30', rain: '#161C2C', sleet: '#181E2E', hail: '#10141F', snow: '#232B45', storm: '#0D111D', heat: '#271C33' },
        hills: ['#1F2856', '#0B1129'], snowHills: ['#C7D0E6', '#97A3C4'], hazeHills: ['#3A3242', '#221D2B'], heatHills: ['#3A2A40', '#241A2C'],
        cloud: '#2B3563', rainCloud: '#2A3142', stormCloud: '#1B2030', snowCloud: '#3A4363',
        orb: '#F1F4FF', ring: '#2C3870', hazeOrb: '#E8C39A', hazeRing: '#4A3A44', heatOrb: '#FBE9D0', heatRing: '#5A3A4A',
        orbX: '78%', orbY: '20%', fog: '#3A4466', haze: '#4A3F4E', wind: '#8C9AD0', leaf: '#4A5A92', leaf2: '#6A78B0', shimmer: '#7A5878', bird: '#9AA6D6'
      }
    };
    var p = PAL[time];
    var sky = p.sky[weather];

    function hx(h) { var n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
    function mix(a, b, t) {
      var x = hx(a), y = hx(b);
      return '#' + [0, 1, 2].map(function (i) { var v = Math.round(x[i] + (y[i] - x[i]) * t); return (v < 16 ? '0' : '') + v.toString(16); }).join('');
    }
    function lum(h) {
      var c = hx(h).map(function (v) { v = v / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
      return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    }
    var darkSky = lum(sky) < 0.18;

    var seed = (TIMES.indexOf(time) + 1) * 7919 + (WEATHERS.indexOf(weather) + 1) * 104729;
    function rnd() {
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
      var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    function range(a, b) { return a + (b - a) * rnd(); }
    function many(n, fn) { var out = []; for (var i = 0; i < n; i++) out.push(fn(i)); return out; }
    var r1 = function (v) { return Math.round(v * 10) / 10; };

    function circ(cx, cy, r) { return 'M' + (cx - r) + ' ' + cy + 'a' + r + ' ' + r + ' 0 1 1 ' + (2 * r) + ' 0a' + r + ' ' + r + ' 0 1 1 ' + (-2 * r) + ' 0Z'; }
    function pill(x, y, w, h) { var rr = h / 2; return 'M' + (x + rr) + ' ' + y + 'h' + (w - h) + 'a' + rr + ' ' + rr + ' 0 0 1 0 ' + h + 'h' + (h - w) + 'a' + rr + ' ' + rr + ' 0 0 1 0 ' + (-h) + 'Z'; }
    var SHAPES = [
      circ(52, 64, 30) + circ(98, 48, 40) + circ(146, 64, 30) + pill(22, 62, 156, 36),
      circ(44, 70, 24) + circ(80, 54, 32) + circ(122, 46, 38) + circ(162, 68, 24) + pill(20, 66, 168, 30),
      circ(64, 60, 34) + circ(116, 54, 38) + pill(30, 58, 132, 38),
      circ(40, 72, 20) + circ(72, 58, 28) + circ(108, 50, 32) + circ(142, 60, 26) + circ(170, 74, 16) + pill(20, 70, 166, 26)
    ];

    // clouds
    var cloudColor = is('rain', 'drizzle', 'sleet') ? p.rainCloud : is('storm', 'hail') ? p.stormCloud : is('snow') ? p.snowCloud : p.cloud;
    var showDeck = is('cloudy', 'drizzle', 'rain', 'sleet', 'hail', 'storm', 'snow');
    var nearCount = { clear: 2, partly: 3, cloudy: 4, windy: 4, fog: 1, haze: 0, drizzle: 3, rain: 4, sleet: 3, hail: 3, snow: 3, storm: 5, heat: 0 }[weather];
    var farCount = { clear: 2, partly: 3, cloudy: 3, windy: 3, fog: 2, haze: 1, drizzle: 3, rain: 3, sleet: 3, hail: 2, snow: 3, storm: 3, heat: 0 }[weather];
    var speed = is('windy') ? 0.22 : is('storm', 'hail') ? 0.55 : 1;
    var clouds = many(nearCount, function (i) {
      var dur = range(80, 150) * speed;
      return { d: SHAPES[i % SHAPES.length], y: r1(showDeck ? range(14, 38) : range(6, 36)), w: Math.round(showDeck ? range(260, 400) : range(200, 330)), dur: r1(dur), delay: r1(-range(0, dur)) };
    });
    var farClouds = many(farCount, function (i) {
      var dur = range(170, 260) * speed;
      return { d: SHAPES[(i + 2) % SHAPES.length], y: r1(range(4, 30)), w: Math.round(range(110, 180)), dur: r1(dur), delay: r1(-range(0, dur)) };
    });
    var deckPath = '';
    if (showDeck) {
      deckPath = 'M-40 0H1480V96H-40Z';
      var x = -60;
      while (x < 1500) { var r = Math.round(range(44, 100)); deckPath += circ(x + r * 0.6, Math.round(range(80, 128)), r); x += Math.round(r * range(0.9, 1.4)); }
    }
    var deckColor = is('snow') ? mix(cloudColor, sky, 0.25) : mix(cloudColor, '#000000', 0.08);

    // orb
    var showOrb = is('clear', 'partly', 'cloudy', 'windy', 'fog', 'haze', 'heat');
    var orb = is('haze') ? p.hazeOrb : is('heat') ? p.heatOrb : p.orb;
    var ring = is('haze') ? p.hazeRing : is('heat') ? p.heatRing : p.ring;
    var showRays = is('heat') && !night;
    var rays = showRays ? many(12, function (i) {
      var a = i * Math.PI / 6, c = Math.cos(a), s = Math.sin(a);
      return { x1: r1(c * 76), y1: r1(s * 76), x2: r1(c * 96), y2: r1(s * 96) };
    }) : [];

    // sky bands (flat sunrise / sunset stripes)
    var showBands = !night && (time === 'morning' || time === 'evening') && is('clear', 'partly', 'windy', 'heat');

    var showStars = night && is('clear', 'partly', 'windy', 'heat', 'fog');
    var stars = showStars ? many(is('fog') ? 30 : 80, function () {
      return { x: r1(range(0, 100)), y: r1(range(0, 62)), r: r1(range(1.2, 3)), dur: r1(range(2, 5.5)), delay: r1(-range(0, 5)) };
    }) : [];

    var showBirds = !night && is('clear', 'partly');
    var birds = showBirds ? many(3, function (i) {
      var dur = range(46, 70);
      return { y: r1(range(14, 34)), w: Math.round(range(18, 28)), dur: r1(dur), delay: r1(-range(0, dur)), flap: r1(-range(0, 1)) };
    }) : [];

    // precipitation
    var showRain = is('rain', 'storm', 'drizzle', 'sleet');
    var dropN = { rain: 90, storm: 130, drizzle: 55, sleet: 50 }[weather] || 0;
    var drops = showRain ? many(dropN, function () {
      var dur = is('drizzle') ? range(1.5, 2.3) : range(0.65, 1.2);
      var len = is('drizzle') ? range(10, 16) : range(18, 36);
      return { x: r1(range(-5, 125)), len: Math.round(len), o: r1(range(0.45, 1)), dur: r1(dur), delay: r1(-range(0, dur)) };
    }) : [];
    var splashes = is('rain', 'storm') ? many(is('storm') ? 22 : 16, function () {
      var dur = range(0.9, 1.8);
      return { x: r1(range(2, 96)), y: r1(range(80, 96)), w: Math.round(range(10, 18)), dur: r1(dur), delay: r1(-range(0, dur)) };
    }) : [];

    var showSnow = is('snow');
    var flakes = showSnow ? many(50, function () {
      var dur = range(14, 24);
      return { x: r1(range(0, 100)), r: r1(range(2, 4)), o: 0.55, dur: r1(dur), delay: r1(-range(0, dur)) };
    }).concat(many(45, function () {
      var dur = range(7, 12);
      return { x: r1(range(0, 100)), r: r1(range(5, 9)), o: r1(range(0.85, 1)), dur: r1(dur), delay: r1(-range(0, dur)) };
    })) : [];

    var showIce = is('sleet', 'hail');
    var ice = showIce ? many(is('hail') ? 60 : 45, function () {
      var hail = is('hail');
      var dur = hail ? range(0.9, 1.4) : range(1.0, 1.6);
      return { cls: hail ? 'sp-hail' : 'sp-pellet', round: hail ? '50%' : '2px', x: r1(range(hail ? 0 : -5, hail ? 105 : 120)), r: r1(hail ? range(6, 11) : range(4, 6)), dur: r1(dur), delay: r1(-range(0, dur)) };
    }) : [];

    var showWind = is('windy');
    var streaks = showWind ? many(18, function () {
      var dur = range(1.8, 3.4);
      return { y: r1(range(6, 70)), w: Math.round(range(100, 300)), h: rnd() < 0.3 ? 4 : 2, dur: r1(dur), delay: r1(-range(0, dur * 1.6)) };
    }) : [];
    var leaves = showWind ? many(12, function (i) {
      var dur = range(5, 9);
      return { y: r1(range(26, 74)), w: Math.round(range(12, 18)), h: Math.round(range(7, 10)), c: i % 2 ? p.leaf2 : p.leaf, dur: r1(dur), delay: r1(-range(0, dur)) };
    }) : [];

    var showHeat = is('heat') && !night;
    var shimmer = showHeat ? many(6, function () {
      var dur = range(3, 5);
      return { x: r1(range(-5, 85)), y: r1(range(70, 80)), w: Math.round(range(160, 260)), dur: r1(dur), delay: r1(-range(0, dur)) };
    }) : [];

    var showFog = is('fog', 'haze');
    var fogBands = is('fog') ? many(7, function (i) {
      var dur = range(16, 30);
      return { x: r1(range(-30, 40)), w: r1(range(55, 95)), y: r1(28 + i * 9 + range(-3, 3)), h: Math.round(range(44, 90)), o: r1(range(0.3, 0.55)), dur: r1(dur), delay: r1(-range(0, dur)) };
    }) : is('haze') ? many(4, function (i) {
      var dur = range(26, 40);
      return { x: r1(range(-30, 20)), w: r1(range(80, 120)), y: r1(18 + i * 16), h: Math.round(range(120, 180)), o: r1(range(0.16, 0.26)), dur: r1(dur), delay: r1(-range(0, dur)) };
    }) : [];

    // hills
    var hp = is('snow') ? [p.snowHills[1], p.snowHills[0]] : is('haze') ? p.hazeHills : is('heat') ? p.heatHills : p.hills;
    if (is('sleet')) hp = [mix(p.hills[0], '#FFFFFF', 0.35), mix(p.hills[1], '#FFFFFF', 0.6)];
    var ridge = is('snow') ? mix(p.snowHills[0], sky, 0.5) : mix(hp[0], sky, 0.55);
    if (is('fog', 'haze')) ridge = mix(ridge, sky, 0.4);

    var dropColor = darkSky ? 'rgba(220,230,255,0.55)' : 'rgba(40,52,72,0.4)';

    return {
      time: time, weather: weather,
      sky: sky,
      showBands: showBands,
      band1: mix(sky, orb, 0.16), band2: mix(sky, orb, 0.32), band3: mix(sky, orb, 0.5),
      showStars: showStars, stars: stars, showShooting: night && is('clear', 'partly', 'windy'),
      showOrb: showOrb, orb: orb, ring: ring, orbX: p.orbX, orbY: p.orbY,
      orbScale: is('heat') && !night ? 1.35 : 1,
      orbOpacity: is('fog') ? 0.5 : is('cloudy') ? 0.65 : is('haze') ? 0.85 : 1,
      showRays: showRays, rays: rays, isNight: night, isDay: !night,
      farClouds: farClouds, farCloud: mix(cloudColor, sky, 0.5),
      showDeck: showDeck, deckPath: deckPath, deck: deckColor, deckShade: mix(deckColor, '#000000', 0.12),
      clouds: clouds, cloud: cloudColor, cloudShade: mix(cloudColor, darkSky ? '#000000' : sky, darkSky ? 0.25 : 0.35),
      showParked: is('partly'), parkedPath: SHAPES[0],
      showBirds: showBirds, birds: birds, bird: p.bird,
      ridge: ridge, hillFar: hp[0], hillNear: hp[1],
      showFog: showFog, fogBands: fogBands, fogColor: is('haze') ? p.haze : p.fog, veil: is('haze') ? 0.22 : 0.14,
      showHeat: showHeat, shimmer: shimmer, shimmerColor: p.shimmer,
      showRain: showRain, drops: drops, splashes: splashes, dropColor: dropColor,
      showSnow: showSnow, flakes: flakes,
      showIce: showIce, ice: ice, iceShade: mix(sky, '#000000', 0.2),
      showWind: showWind, streaks: streaks, leaves: leaves, windColor: p.wind,
      showStorm: is('storm')
    };

  }

  function look(p, s) {
    p = p.trim();
    if (p === 'true') return true;
    if (p === 'false') return false;
    if (/^-?[0-9]/.test(p)) return +p;
    var parts = p.split('.'), v = s[parts[0]];
    for (var i = 1; i < parts.length; i++) { if (v == null) return v; v = v[parts[i]]; }
    return v;
  }
  function interp(t, s) { return t.replace(/\{\{\s*([^}]+?)\s*\}\}/g, function (m, p) { var v = look(p, s); return v == null ? '' : v; }); }
  function whole(t) { var m = /^\s*\{\{\s*([^}]+?)\s*\}\}\s*$/.exec(t || ''); return m ? m[1] : null; }
  function render(n, s, par) {
    if (n.nodeType === 3) { par.appendChild(document.createTextNode(interp(n.textContent, s))); return; }
    if (n.nodeType !== 1) return;
    var ln = n.localName;
    if (ln === 'sc-if') { if (look(whole(n.getAttribute('value')), s)) n.childNodes.forEach(function (c) { render(c, s, par); }); return; }
    if (ln === 'sc-for') {
      var list = look(whole(n.getAttribute('list')), s) || [], as = n.getAttribute('as');
      list.forEach(function (it, i) { var sc = Object.create(s); sc[as] = it; sc.$index = i; n.childNodes.forEach(function (c) { render(c, sc, par); }); });
      return;
    }
    var el = document.createElementNS(n.namespaceURI, ln);
    for (var i = 0; i < n.attributes.length; i++) { var a = n.attributes[i]; el.setAttribute(a.name, interp(a.value, s)); }
    n.childNodes.forEach(function (c) { render(c, s, el); });
    par.appendChild(el);
  }

  var tplNode = null, uid = 0;
  function ensureSetup() {
    if (tplNode) return;
    var st = document.createElement('style');
    st.setAttribute('data-skypeek-weather', '');
    st.textContent = CSS;
    document.head.appendChild(st);
    var t = document.createElement('template');
    t.innerHTML = TEMPLATE;
    tplNode = t.content;
  }

  function mount(el, opts) {
    ensureSetup();
    var state = Object.assign({ time: 'random', weather: 'random' }, opts || {});
    var holder = document.createElement('div');
    holder.setAttribute('aria-hidden', 'true');
    holder.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:0';
    el.insertBefore(holder, el.firstChild);
    var api = {
      scene: null,
      update: function (next) {
        Object.assign(state, next || {});
        var v = compute(state);
        var id = 'spMoonCut' + (++uid);
        holder.innerHTML = '';
        tplNode.childNodes.forEach(function (c) { render(c, v, holder); });
        var mask = holder.querySelector('mask');
        if (mask) { mask.id = id; var moon = holder.querySelector('[mask]'); if (moon) moon.setAttribute('mask', 'url(#' + id + ')'); }
        api.scene = { time: v.time, weather: v.weather, label: LABELS[v.weather], sky: v.sky };
        return api;
      },
      destroy: function () { holder.remove(); }
    };
    return api.update();
  }

  global.SkyPeekWeather = { mount: mount, TIMES: TIMES, WEATHERS: WEATHERS, LABELS: LABELS };
})(typeof window !== 'undefined' ? window : this);
