import {
  ChevronDown, ChevronRight, Crosshair, Layers3, Map, MapPin,
  Minus, Play, Plus, RadioTower, Ruler, Search, SkipBack, SkipForward,
} from 'lucide-react';

export function DesktopRadarMap() {
  return <svg className="dm-map" viewBox="0 0 390 790" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
    <rect width="390" height="790" fill="#fafaf8"/>
    <path d="M312 -20 C277 85 304 153 356 207 C400 261 382 319 421 357 L421 810 L304 810 C277 740 300 694 265 635 C231 577 254 506 285 450 C317 390 271 337 290 282 C308 228 251 152 278 90Z" fill="#d8e9f4"/>
    <g fill="none" stroke="#cdd8da" strokeWidth="2"><path d="M335 5 C315 88 343 125 323 204 M282 302 C360 331 339 386 286 442 M298 548 C340 600 295 676 323 760"/></g>
    <g fill="none" stroke="#d5d7d4" strokeWidth="2"><path d="M-30 72 L307 196 M-20 144 L325 274 M-20 243 L302 347 M-20 350 L290 437 M-20 461 L299 530 M-20 559 L288 625 M-20 660 L325 714 M35 -20 L127 790 M123 -20 L196 790 M203 -20 L260 790 M271 -20 L184 790 M-20 732 L324 50 M-20 523 L298 6"/></g>
    <g fill="none" stroke="#fff" strokeWidth="9"><path d="M-15 397 C95 412 180 447 327 477 M88 -20 C116 199 166 419 244 810 M-25 675 C91 577 162 480 296 288"/></g>
    <g fill="none" stroke="#a2aaa9" strokeWidth="2"><path d="M-15 397 C95 412 180 447 327 477 M88 -20 C116 199 166 419 244 810 M-25 675 C91 577 162 480 296 288"/></g>
    <g fill="none" stroke="#aeb4b1" strokeWidth="1"><path d="M-20 190 L320 334 M-20 290 L321 405 M-20 596 L283 684 M-20 711 L210 774 M12 -10 L86 790 M165 -20 L110 790 M252 -20 L45 790"/></g>
    <g fill="#4e5553" fontFamily="Arial, sans-serif" fontSize="11" fontWeight="600"><text x="14" y="131">Centerton</text><text x="215" y="116">Bella Vista</text><text x="47" y="270">Cave Springs</text><text x="196" y="303">Bentonville</text><text x="36" y="519">Springdale</text><text x="214" y="570">Rogers</text><text x="44" y="699">Fayetteville</text><text x="271" y="735">Beaver Lake</text></g>
    <g className="dm-rain" fill="#7da8c0"><path d="M70 175 C98 147 143 154 170 181 C205 170 233 201 226 231 C247 254 218 289 182 284 C145 302 104 278 76 283 C41 260 40 206 70 175Z"/><path d="M135 302 C161 279 203 296 215 326 C251 317 282 342 273 372 C281 406 242 432 211 416 C171 430 144 407 144 378 C119 356 115 323 135 302Z"/><path d="M18 438 C45 414 99 422 117 452 C147 468 138 509 103 519 C72 540 27 516 15 487 C-5 469 2 452 18 438Z"/></g>
  </svg>;
}

export function CondensedRadarContent() {
  return <><DesktopRadarMap/><div className="dm-top"><div className="dm-search"><Search size={18}/><span>Search city, address, or county</span></div><div className="dm-condensed-tools"><span><Plus size={19}/></span><span><Minus size={19}/></span><span><Crosshair size={19}/></span><span><Layers3 size={19}/></span><span><Map size={18}/> Satellite</span></div><div className="dm-legend"><span>-20</span><span>-10</span><span>0</span><span>10</span><span>20</span><span>30</span><span>40</span><span>50</span><span>60</span><span>70</span><div/></div></div><div className="dm-floating-tools"><span><RadioTower size={18}/></span><span><MapPin size={18}/></span><span><Ruler size={18}/></span></div><div className="dm-location-dot"/><div className="dm-source"><b>NOAA · National reflectivity</b><span>3:33 PM · 3 min ago · NOAA / NWS</span></div><div className="dm-playback compact"><div className="dm-playback-row"><SkipBack size={15}/><Play size={16} fill="currentColor"/><SkipForward size={15}/><span className="dm-speed">1× <ChevronDown size={12}/></span><span className="dm-range">6 h <ChevronDown size={12}/></span></div><div className="dm-playback-rail"><i/><span>3:33 PM</span></div><div className="dm-playback-latest">Now <ChevronRight size={13}/></div></div></>;
}
