/* ShuddhiQA deck navigation — keyboard, click, dots, swipe, progress, deep-link */
(function(){
  var slides = Array.prototype.slice.call(document.querySelectorAll('.slide'));
  if(!slides.length) return;
  var i = 0;
  var bar = document.querySelector('.progress');
  var counter = document.querySelector('.counter');
  var dotsWrap = document.querySelector('.dots');

  // build dots
  slides.forEach(function(_, idx){
    var b = document.createElement('button');
    b.className = 'dot'; b.setAttribute('aria-label','Slide '+(idx+1));
    b.addEventListener('click', function(){ go(idx); });
    dotsWrap.appendChild(b);
  });
  var dots = Array.prototype.slice.call(dotsWrap.children);

  function render(){
    slides.forEach(function(s,idx){ s.classList.toggle('active', idx===i); });
    dots.forEach(function(d,idx){ d.classList.toggle('on', idx===i); });
    var grad = slides[i].classList.contains('hero') || slides[i].classList.contains('section');
    document.body.classList.toggle('dark-slide', grad);
    if(bar) bar.style.width = ((i)/(slides.length-1)*100)+'%';
    if(counter) counter.textContent = String(i+1).padStart(2,'0')+' / '+String(slides.length).padStart(2,'0');
    if(location.hash !== '#'+(i+1)) history.replaceState(null,'','#'+(i+1));
  }
  function go(n){ i = Math.max(0, Math.min(slides.length-1, n)); render(); }
  function next(){ go(i+1); } function prev(){ go(i-1); }

  // keyboard
  document.addEventListener('keydown', function(e){
    if(e.key==='ArrowRight'||e.key==='PageDown'||e.key===' '){ e.preventDefault(); next(); }
    else if(e.key==='ArrowLeft'||e.key==='PageUp'){ e.preventDefault(); prev(); }
    else if(e.key==='Home'){ go(0); } else if(e.key==='End'){ go(slides.length-1); }
    else if(e.key==='f'||e.key==='F'){ toggleFs(); }
    document.body.classList.remove('fresh');
  });

  // click zones (left third = prev, rest = next) — but ignore links/buttons
  document.addEventListener('click', function(e){
    if(e.target.closest('a,button,.dots,.nav')) return;
    if(e.clientX < window.innerWidth*0.33) prev(); else next();
    document.body.classList.remove('fresh');
  });

  // on-screen controls
  var pv=document.querySelector('[data-prev]'), nx=document.querySelector('[data-next]');
  if(pv) pv.addEventListener('click', function(e){e.stopPropagation();prev();});
  if(nx) nx.addEventListener('click', function(e){e.stopPropagation();next();});

  // swipe
  var x0=null;
  addEventListener('touchstart',function(e){x0=e.touches[0].clientX;},{passive:true});
  addEventListener('touchend',function(e){
    if(x0===null) return; var dx=e.changedTouches[0].clientX-x0;
    if(Math.abs(dx)>50){ dx<0?next():prev(); } x0=null;
  },{passive:true});

  function toggleFs(){
    if(!document.fullscreenElement){ (document.documentElement.requestFullscreen||function(){})(); }
    else { (document.exitFullscreen||function(){})(); }
  }

  // deep link
  var start = parseInt((location.hash||'').replace('#',''),10);
  if(start>=1 && start<=slides.length) i = start-1;
  document.body.classList.add('fresh');
  render();
})();
