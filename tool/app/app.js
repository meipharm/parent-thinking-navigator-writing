(function () {
  'use strict';

  var CASE_ORDER = ['A'];
  var ACTION_LABEL = { hint: '提示', teach: '示範（直接教）', pause: '暫停', 'continue': '讓孩子自己試' };

  var WIZ_ID = 'WIZ';
  var GUIDE_ID = 'GUIDE';
  var TEACHER_ID = 'TEACHER';

  var WIZ_TASK = {
    title: '今天只做這一件小事',
    text: '請孩子自己補一句，說明當時最讓他印象深刻的是哪個地方。只補一句就好。',
    note: 'AI 加的細節，孩子沒有看到或沒有經歷過的，就不要寫進去，也不要抄 AI 的版本。'
  };
  var STAGES = ['準備提示詞', '貼回 Claude 的回覆', '引導孩子', '孩子自己改', '記錄與下次建議'];
  var DEFAULT_PAUSE = {
    say: '我們先休息一下，等你準備好再繼續，好嗎？',
    why: '孩子或你自己覺得累、煩的時候，暫停比硬撐有效。你隨時可以決定停下來，明天再做也可以。'
  };

  var state = { caseId: 'A', sectionId: null, step: 0, branch: null, pause: false, point: 0, alt: false, focusId: null };
  var wiz = newWiz();
  // 驗證勾選與回顧作答只存在記憶體，重新整理就消失。
  var vs = { pick: { child: null, parent: null }, checks: { child: [], parent: [] } };
  var rv = { answers: [], mode: null, shown: false, open: false };

  function newWiz() {
    return {
      stage: 1, original: '', polished: '', reply: '', data: null, error: '',
      rec: { topic: '', original: '', asked: '', said: '', revised: '', reactions: [], verify: '', note: '', advice: '' }
    };
  }

  // 新芽成長圖：四個階段的固定原創圖案（常數字串，不含任何使用者輸入）。
  var SOIL = '<path d="M10 70h60" stroke="#c9a27a" stroke-width="4" stroke-linecap="round"/>';
  var GROWTH_SVG = [
    SOIL + '<ellipse cx="40" cy="62" rx="9" ry="6" fill="#b07a4a"/><path d="M36 60c2-2 6-2 8 0" stroke="#8a5a32" stroke-width="1.5" fill="none"/>',
    SOIL + '<path d="M40 68V50" stroke="#5aa832" stroke-width="3" stroke-linecap="round"/>' +
      '<path d="M40 55c-8 0-12-4-12-10 7 0 12 4 12 10z" fill="#7cc243"/><path d="M40 52c0-6 4-10 11-10 0 6-4 10-11 10z" fill="#5aa832"/>',
    SOIL + '<path d="M40 68V28" stroke="#5aa832" stroke-width="3" stroke-linecap="round"/>' +
      '<path d="M40 60c-9 0-14-5-14-12 8 0 14 5 14 12z" fill="#7cc243"/><path d="M40 52c0-7 5-12 13-12 0 7-5 12-13 12z" fill="#5aa832"/>' +
      '<path d="M40 42c-7 0-11-4-11-10 6 0 11 4 11 10z" fill="#7cc243"/><path d="M40 35c0-6 4-9 10-9 0 6-4 9-10 9z" fill="#5aa832"/>',
    SOIL + '<path d="M40 68V28" stroke="#5aa832" stroke-width="3" stroke-linecap="round"/>' +
      '<path d="M40 60c-9 0-14-5-14-12 8 0 14 5 14 12z" fill="#7cc243"/><path d="M40 52c0-7 5-12 13-12 0 7-5 12-13 12z" fill="#5aa832"/>' +
      '<path d="M40 42c-7 0-11-4-11-10 6 0 11 4 11 10z" fill="#7cc243"/>' +
      '<g fill="#ffb366"><circle cx="40" cy="14" r="6"/><circle cx="49" cy="22" r="6"/><circle cx="40" cy="30" r="6"/><circle cx="31" cy="22" r="6"/></g>' +
      '<circle cx="40" cy="22" r="5" fill="#e8590c"/>'
  ];

  function growthBadge(growth, cls) {
    var pic = document.createElement('div');
    pic.className = 'growth-pic';
    pic.setAttribute('aria-hidden', 'true');
    pic.innerHTML = '<svg viewBox="0 0 80 80" xmlns="http://www.w3.org/2000/svg">' + GROWTH_SVG[growth.level] + '</svg>';
    return el('div', { 'class': 'growth ' + (cls || '') }, [
      pic,
      el('div', {}, [el('p', { 'class': 'growth-name', text: '這次的成長：' + growth.name }), el('p', { text: growth.message })])
    ]);
  }

  // 家長回顧的作答（供 PDF 與新芽使用），題目沿用案例 A 的回顧題。
  function currentReview() {
    var a = findCase('A');
    var s = a && a.sections.filter(function (x) { return x.id === 'review'; })[0];
    if (!s || !s.review) return null;
    return { questions: s.review.questions, answers: rv.answers, modes: s.review.modes, mode: rv.mode };
  }

  function todayStr() {
    var d = new Date();
    function pad(n) { return n < 10 ? '0' + n : String(n); }
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function renderPrintArea(doc) {
    var kids = [el('h1', { text: doc.title }), el('p', { 'class': 'print-meta', text: '日期：' + doc.date })];
    if (doc.growth) kids.push(growthBadge(doc.growth, 'print-growth'));
    doc.sections.forEach(function (s) {
      kids.push(el('h2', { text: s.heading }));
      s.items.forEach(function (t) { kids.push(el('p', { 'class': 'print-text', text: t })); });
    });
    kids.push(el('p', { 'class': 'print-foot', text: doc.footer }));
    return el('div', { id: 'print-area' }, kids);
  }

  var PDF_MAX_PAGES = 2;
  var PDF_FONT_SIZES = [11, 10.5, 10, 9.5, 9];

  // 依 A4（邊距 18 mm）實際排版量高度，從大到小挑第一個能排進 2 頁的字級。
  // 回傳 { fits, size }；9pt 仍超過時 fits 為 false。
  function fitToPages(area) {
    var maxPx = PDF_MAX_PAGES * 261 * 96 / 25.4;
    var fits = false;
    var size = PDF_FONT_SIZES[PDF_FONT_SIZES.length - 1];
    area.style.cssText = 'display:block;position:absolute;left:-9999px;top:0;width:174mm;';
    for (var i = 0; i < PDF_FONT_SIZES.length; i++) {
      area.style.fontSize = PDF_FONT_SIZES[i] + 'pt';
      if (area.scrollHeight <= maxPx) { fits = true; size = PDF_FONT_SIZES[i]; break; }
    }
    area.style.cssText = 'font-size:' + size + 'pt;';
    return { fits: fits, size: size };
  }

  // 列印畫面只顯示 #print-area；使用者在列印視窗選「另存為 PDF」即可存檔。
  function exportPdf() {
    var doc = window.PromptBuilder.buildReviewDoc(wiz.rec, wiz.data, todayStr(), currentReview());
    if (!doc) return;
    var stale = document.getElementById('print-area');
    if (stale) stale.parentNode.removeChild(stale);
    var area = renderPrintArea(doc);
    var oldTitle = document.title;
    document.body.appendChild(area);
    var fit = fitToPages(area);
    var note = document.getElementById('r-export-status');
    if (note) {
      note.textContent = fit.fits ? '' : '內容比較長，PDF 可能超過 ' + PDF_MAX_PAGES + ' 頁。請縮短「原稿」或「修改後的句子」，或只貼 Claude 建議的重點。';
    }
    document.title = doc.title + '-' + doc.date;
    function cleanup() {
      window.removeEventListener('afterprint', cleanup);
      if (area.parentNode) area.parentNode.removeChild(area);
      document.title = oldTitle;
    }
    window.addEventListener('afterprint', cleanup);
    window.print();
  }

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'text') node.textContent = attrs[k];
      else if (k === 'onclick') node.addEventListener('click', attrs[k]);
      else node.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { if (c) node.appendChild(c); });
    return node;
  }

  function getCases() {
    var all = window.CASES || {};
    return CASE_ORDER.filter(function (id) { return all[id]; }).map(function (id) { return all[id]; });
  }

  function findCase(id) { return (window.CASES || {})[id]; }

  function selectCase(id) {
    var c = findCase(id);
    state.caseId = id;
    state.sectionId = c ? c.sections[0].id : null;
    state.step = 0;
    state.branch = null;
    state.pause = false;
    state.point = 0;
    state.alt = false;
    state.focusId = 'case-' + id;
    render();
  }

  function selectSection(id, step) {
    state.sectionId = id;
    state.step = step || 0;
    state.branch = null;
    state.pause = false;
    state.focusId = 'sec-' + id;
    render();
  }

  function setStage(n) {
    wiz.stage = n;
    state.step = 0;
    state.branch = null;
    state.pause = false;
    state.focusId = 'wiz-' + n;
    render();
  }

  function renderCaseTabs() {
    var tabs = el('div', { 'class': 'tabs', role: 'tablist', 'aria-label': '選擇功能' });
    getCases().forEach(function (c) {
      tabs.appendChild(el('button', {
        id: 'case-' + c.id, role: 'tab', 'aria-selected': String(c.id === state.caseId),
        text: c.title, onclick: function () { selectCase(c.id); }
      }));
    });
    tabs.appendChild(el('button', {
      id: 'case-' + WIZ_ID, role: 'tab', 'aria-selected': String(state.caseId === WIZ_ID),
      text: '貼上孩子的作文', onclick: function () { selectCase(WIZ_ID); }
    }));
    tabs.appendChild(el('button', {
      id: 'case-' + GUIDE_ID, role: 'tab', 'aria-selected': String(state.caseId === GUIDE_ID),
      text: '作文重點', onclick: function () { selectCase(GUIDE_ID); }
    }));
    tabs.appendChild(el('button', {
      id: 'case-' + TEACHER_ID, role: 'tab', 'aria-selected': String(state.caseId === TEACHER_ID),
      text: '老師怎麼看作文', onclick: function () { selectCase(TEACHER_ID); }
    }));
    return tabs;
  }

  function bindCopy(button, output, status) {
    button.addEventListener('click', function () {
      function done() { status.textContent = '已複製。請貼到 Claude 的對話框。'; }
      function fallback() {
        output.select();
        status.textContent = document.execCommand('copy') ? '已複製。請貼到 Claude 的對話框。' : '複製沒有成功，請手動選取上方文字再複製。';
      }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(output.value).then(done, fallback);
      } else {
        fallback();
      }
    });
  }

  function renderWritingGuide() {
    var g = window.WRITING_GUIDE;
    if (!g) return el('p', { text: '作文重點資料沒有載入，請確認 examples 資料夾的檔案都在。' });

    // 公開版會拿掉參考付費課程整理的區塊，所以除了四個面向，其餘區塊有資料才顯示。
    var head = [
      el('p', { 'class': 'mode', text: '給家長的參考' }),
      el('h2', { text: g.title }),
      el('p', { text: g.intro }),
      el('p', { 'class': 'note', text: g.caution })
    ];
    if (g.refUrl) {
      head.push(
        el('p', { 'class': 'why', text: '參考來源：' }),
        el('p', {}, [el('a', { id: 'ref-link', href: g.refUrl, target: '_blank', rel: 'noopener noreferrer', text: g.refText })]),
        el('p', { 'class': 'why', text: g.refUrl })
      );
    }
    head.push(el('button', { id: 'to-teacher', text: '看「老師怎麼看作文」（評分觀點與課綱）', onclick: function () { selectCase(TEACHER_ID); } }));

    var cards = [
      el('div', { 'class': 'card case-head' }, head),
      el('div', { 'class': 'card' }, [
        el('h3', { text: '作文的四個面向' }),
        tableOf(['面向', '白話說明', '中高年級現階段先做到', '家長可以這樣問', '和這個工具的關係'],
          g.dimensions.map(function (d) { return [d.name, d.meaning, d.now, '「' + d.ask + '」', d.link]; })),
        g.dimensionsSource ? el('p', { 'class': 'why', text: g.dimensionsSource }) : null
      ])
    ];
    if (g.aiChecks) {
      cards.push(el('div', { 'class': 'card' }, [
        el('h3', { text: g.aiTitle }),
        tableOf(['檢查重點', '意思', '家長可以怎麼做'],
          g.aiChecks.map(function (c, i) { return [(i + 1) + '. ' + c.point, c.meaning, c.action]; })),
        el('p', { 'class': 'why', text: g.aiSource })
      ]));
    }
    if (g.genres) {
      cards.push(el('div', { 'class': 'card' }, [
        el('h3', { text: g.genreTitle }),
        tableOf(['文章類型', '種類', '檢查重點', '什麼時候用'], g.genres.map(function (x) { return [x.type, x.kind, x.check, x.now]; })),
        el('p', { 'class': 'why', text: g.genreSource })
      ]));
    }
    if (g.human) {
      cards.push(el('div', { 'class': 'card' }, [el('h3', { text: g.humanTitle }), bulletList(g.human), el('p', { 'class': 'note', text: g.humanNote })]));
    }
    if (g.tasks) {
      cards.push(el('div', { 'class': 'card' }, [
        el('h3', { text: g.tasksTitle }),
        tableOf(['單元', '什麼時候', '說明'], g.tasks.map(function (t) { return [t.name, t.when, t.note]; })),
        el('p', { 'class': 'why', text: g.source })
      ]));
    }
    return el('div', {}, cards);
  }

  function tableOf(headers, rows) {
    var head = el('tr', {}, headers.map(function (h) { return el('th', { text: h }); }));
    var body = rows.map(function (r) { return el('tr', {}, r.map(function (c) { return el('td', { text: c }); })); });
    return el('table', {}, [el('thead', {}, [head]), el('tbody', {}, body)]);
  }

  function renderTeacherView() {
    var t = window.TEACHER_VIEW;
    if (!t) return el('p', { text: '老師觀點資料沒有載入，請確認 examples 資料夾的檔案都在。' });

    var sources = el('ul', {}, t.sources.map(function (s) {
      var label = s.url
        ? el('a', { href: s.url, target: '_blank', rel: 'noopener noreferrer', text: s.label })
        : el('span', { text: s.label });
      return el('li', {}, [label, el('span', { 'class': 'why', text: '　' + s.note })]);
    }));

    return el('div', {}, [
      el('div', { 'class': 'card case-head' }, [
        el('p', { 'class': 'mode', text: '給家長的參考' }),
        el('h2', { text: t.title }),
        el('p', { text: t.intro }),
        el('p', { 'class': 'note', text: t.caution })
      ]),
      el('div', { 'class': 'card' }, [el('h3', { text: t.principlesTitle }), bulletList(t.principles)]),
      el('div', { 'class': 'card' }, [
        el('h3', { text: t.dimensionsTitle }),
        tableOf(['面向', '課綱對應', '老師常看什麼', '會考六級分（長期方向）', '家長可以這樣問'],
          t.dimensions.map(function (d) { return [d.name, d.curriculum, d.teacherLooks, d.exam, '「' + d.ask + '」']; })),
        el('p', { 'class': 'why', text: t.dimensionsNote })
      ]),
      el('div', { 'class': 'card' }, [
        el('h3', { text: t.commentsTitle }),
        tableOf(['老師評語', '白話意思', '對應面向', '家長下一句'],
          t.comments.map(function (c) { return [c.comment, c.meaning, c.dimension, '「' + c.ask + '」']; })),
        el('p', { 'class': 'why', text: t.commentsNote })
      ]),
      el('div', { 'class': 'card' }, [
        el('h3', { text: t.curriculumTitle }),
        tableOf(['編號', '課綱原文', '白話'], t.curriculum.map(function (c) { return [c.code, c.text, c.plain]; })),
        el('p', { 'class': 'why', text: t.curriculumNote })
      ]),
      el('div', { 'class': 'card' }, [
        el('h3', { text: t.modelTitle }),
        el('h4', { text: '可以這樣用' }), bulletList(t.modelDos),
        el('h4', { text: '請避免' }), bulletList(t.modelDonts, 'donts')
      ]),
      el('div', { 'class': 'card' }, [el('h3', { text: t.sourcesTitle }), sources]),
      el('button', { id: 'to-guide-from-teacher', text: '回到「作文重點」', onclick: function () { selectCase(GUIDE_ID); } })
    ]);
  }

  // ---- 新作文引導（五步驟）----

  function renderWizBar() {
    return el('div', { 'class': 'wiz-bar', role: 'navigation', 'aria-label': '步驟' }, STAGES.map(function (name, i) {
      var n = i + 1;
      return el('button', {
        id: 'wiz-' + n, 'class': 'wiz-step' + (n === wiz.stage ? ' on' : n < wiz.stage ? ' done' : ''),
        'aria-current': n === wiz.stage ? 'step' : 'false', text: n + ' ' + name,
        onclick: function () { setStage(n); }
      });
    }));
  }

  function stageHead(title, text) {
    return el('div', { 'class': 'card case-head' }, [
      el('p', { 'class': 'mode', text: '第 ' + wiz.stage + ' 步，共 ' + STAGES.length + ' 步' }),
      el('h2', { text: title }),
      el('p', { text: text })
    ]);
  }

  function renderWizPrepare() {
    var original = el('textarea', {
      id: 'p-original', 'class': 'essay-input', rows: '8',
      placeholder: '直接把孩子寫的作文貼上來，或照著打進來。\n例如：今天我去博物館，看到戰車覺得很酷。'
    });
    var polished = el('textarea', { id: 'p-polished', rows: '4', placeholder: '沒有的話可以空著' });
    var output = el('textarea', { id: 'p-output', rows: '10', readonly: 'readonly', 'aria-label': '產生的提示詞', placeholder: '貼上孩子的原稿後，提示詞會出現在這裡' });
    var status = el('p', { id: 'p-status', 'class': 'why', role: 'status' });
    var copyBtn = el('button', { id: 'p-copy', text: '複製提示詞' });
    var next = el('button', { id: 'p-next', 'class': 'primary', text: '我已貼到 Claude，下一步', onclick: function () { setStage(2); } });
    original.value = wiz.original;
    polished.value = wiz.polished;

    function refresh() {
      wiz.original = original.value;
      wiz.polished = polished.value;
      var text = window.PromptBuilder.build(wiz.original, wiz.polished);
      output.value = text;
      copyBtn.disabled = !text;
      next.disabled = !text;
      status.textContent = text ? '' : '請先貼上孩子的原稿。';
    }
    original.addEventListener('input', refresh);
    polished.addEventListener('input', refresh);
    bindCopy(copyBtn, output, status);
    refresh();

    return el('div', {}, [
      stageHead('貼上孩子的作文', '把作文貼進來，網頁會整理成一段提示詞，你再貼到 Claude。網頁不會分析作文，也不會連網。'),
      el('div', { 'class': 'card' }, [
        el('label', { 'for': 'p-original', 'class': 'big-label', text: '① 把孩子寫的作文貼在這裡（必填）' }), original,
        el('p', { 'class': 'note', text: '請先刪掉孩子的姓名、學校、班級、電話等可以辨識身分的資料。' }),
        el('label', { 'for': 'p-polished', 'class': 'big-label', text: '② 有用 AI 潤飾過的版本嗎？有的話貼在這裡（選填）' }), polished,
        el('label', { 'for': 'p-output', 'class': 'big-label', text: '③ 複製這段提示詞，貼到 Claude' }), output,
        el('div', { 'class': 'stepper' }, [copyBtn, next]), status
      ])
    ]);
  }

  function renderWizReply() {
    var reply = el('textarea', { id: 'w-reply', rows: '10', placeholder: '把 Claude 的整段回覆貼在這裡' });
    reply.value = wiz.reply;
    reply.addEventListener('input', function () { wiz.reply = reply.value; });

    var start = el('button', {
      id: 'w-start', 'class': 'primary', text: '開始引導孩子',
      onclick: function () {
        wiz.reply = reply.value;
        var res = window.PromptBuilder.parseReply(wiz.reply);
        if (res.ok) { wiz.data = res.data; wiz.error = ''; setStage(3); }
        else { wiz.data = null; wiz.error = res.error; state.focusId = 'w-start'; render(); }
      }
    });
    var sample = el('button', {
      id: 'w-sample', text: '用範例回覆試看看',
      onclick: function () { wiz.reply = window.SAMPLE_REPLY_TEXT || ''; wiz.error = ''; state.focusId = 'w-start'; render(); }
    });

    return el('div', {}, [
      stageHead('貼回 Claude 的回覆', 'Claude 回覆後，把整段貼回來。網頁會把它變成一題一題的引導畫面，跟案例 A 一樣。'),
      el('div', { 'class': 'card' }, [
        el('label', { 'for': 'w-reply', text: 'Claude 的回覆' }), reply,
        wiz.error ? el('p', { 'class': 'error', role: 'alert', text: wiz.error }) : null,
        el('p', { 'class': 'why', text: '貼上後格式讀不懂時，請對 Claude 說：「請只用 JSON 格式重新回覆」。還沒有回覆，也可以先用範例回覆走一遍流程。' }),
        el('div', { 'class': 'stepper' }, [sample, start])
      ])
    ]);
  }

  function needReply() {
    return el('div', { 'class': 'card' }, [
      el('p', { text: '還沒有可以引導的內容。請先完成第 2 步，把 Claude 的回覆貼回來。' }),
      el('button', { id: 'need-reply', 'class': 'primary', text: '回到第 2 步', onclick: function () { setStage(2); } })
    ]);
  }

  function aiPause() {
    var a = findCase('A');
    var ask = a && a.sections.filter(function (s) { return s.id === 'ask'; })[0];
    return (ask && ask.pause) || DEFAULT_PAUSE;
  }

  function renderWizGuide() {
    if (!wiz.data) return needReply();
    var d = wiz.data;
    var notes = [];
    if (d.strengths.length) notes.push(el('h4', { text: '值得保留的優點' }), bulletList(d.strengths));
    if (d.cautions.length) notes.push(el('h4', { text: '家長要留意' }), bulletList(d.cautions));

    var steps = renderGuidedSteps(
      { steps: d.questions, pause: aiPause() },
      { doneText: '孩子開始自己改', onDone: function () { setStage(4); } }
    );
    return el('div', {}, [
      notes.length ? el('details', { 'class': 'card more' }, [el('summary', { text: '先看這次的優點與要留意的地方' })].concat(notes)) : null,
      steps
    ]);
  }

  function renderVocabRows(rows) {
    var head = el('tr', {}, ['孩子常用的詞', '白話替代詞', '可學的成語', '再晚一點的詞'].map(function (t) { return el('th', { text: t }); }));
    var body = rows.map(function (r) {
      return el('tr', {}, [r.childWord, r.alternatives.join('、'), r.idioms.join('、'), r.later.join('、')]
        .map(function (t) { return el('td', { text: t }); }));
    });
    return el('table', {}, [el('thead', {}, [head]), el('tbody', {}, body)]);
  }

  function renderWizRevise() {
    if (!wiz.data) return needReply();
    var d = wiz.data;
    var a = findCase('A');
    var aRevise = a && a.sections.filter(function (s) { return s.id === 'revise'; })[0];
    var revise = d.revise.length ? d.revise : [
      '請孩子用自己的話，把剛剛說出來的細節和原因，寫成一兩句。',
      '改完請他說說：「你為什麼這樣改？」'
    ];
    var verify = d.verify.length ? d.verify : [
      '問：「如果同學的作文只寫『很好玩』，你會問他什麼？」',
      '給一個新句子，請孩子自己補一個細節或原因。'
    ];

    var cards = [
      el('div', { 'class': 'card' }, [el('h3', { text: '陪孩子修改' }), bulletList(revise)]),
      el('div', { 'class': 'card' }, [el('h3', { text: '確認孩子真的懂' }), bulletList(verify)])
    ];
    if (d.vocab.length) {
      cards.push(el('div', { 'class': 'card' }, [
        el('h3', { text: '換個說法（給家長的參考）' }),
        el('p', { 'class': 'why', text: '先讓孩子自己想；想不出來才給兩個選項。孩子說得出成語的意思才用，一篇 1 到 2 個就好。' }),
        renderVocabRows(d.vocab)
      ]));
    }
    if (aRevise && aRevise.donts && aRevise.donts.length) {
      cards.push(el('div', { 'class': 'card' }, [el('h3', { text: '請避免' }), bulletList(aRevise.donts, 'donts')]));
    }
    var aVerify = a && a.sections.filter(function (s) { return s.id === 'verify'; })[0];
    if (aVerify && aVerify.layers) cards.push(renderVerifyLayers(aVerify.layers, aVerify.note, false));
    cards.push(el('button', { id: 'to-record', 'class': 'primary', text: '孩子改完了，記錄這次成果', onclick: function () { setStage(5); } }));

    return el('div', {}, [
      stageHead('孩子自己改', '這一步不需要 AI：請讓孩子自己在紙上或口頭修改，家長只當陪伴者。'),
      taskCard(WIZ_TASK)
    ].concat(cards));
  }

  function renderWizRecord() {
    var rec = wiz.rec;
    if (!rec.original) rec.original = wiz.original;

    function area(id, key, label, rows, placeholder) {
      var t = el('textarea', { id: id, rows: String(rows), placeholder: placeholder || '' });
      t.value = rec[key];
      return [el('label', { 'for': id, text: label }), t];
    }
    function choices(name, label, type, options, selected) {
      var box = el('fieldset', { 'class': 'choices' }, [el('legend', { text: label })]);
      options.forEach(function (o, i) {
        var id = name + '-' + i;
        var input = el('input', { type: type, id: id, name: name, value: o });
        if (selected.indexOf(o) >= 0) input.checked = true;
        box.appendChild(el('div', {}, [input, el('label', { 'for': id, 'class': 'inline', text: ' ' + o })]));
      });
      return box;
    }

    var topic = el('input', { type: 'text', id: 'r-topic', 'class': 'topic-input', placeholder: '例如：參觀博物館、我的拿手菜' });
    topic.value = rec.topic;

    var form = el('div', { 'class': 'card' }, [].concat(
      [el('label', { 'for': 'r-topic', text: '這篇作文的題目或主題' }), topic],
      area('r-original', 'original', '孩子的原稿（選填，讓建議更貼近）', 3, '貼上孩子原本寫的句子'),
      area('r-asked', 'asked', '你問了孩子什麼？', 3, '例如：最先注意到它哪個地方？'),
      area('r-said', 'said', '孩子怎麼回答？（照他的原話寫，比你的問題更重要）', 4, '例如：孩子說「砲管很長，像一根大柱子」；回答「不知道」「好煩」也照寫'),
      area('r-revised', 'revised', '孩子修改後的句子', 3, '照孩子寫的原樣記錄'),
      [choices('r-reactions', '過程中的狀況（可複選）', 'checkbox',
        ['順利說出自己的想法', '需要提示才說得出來', '需要我直接教方法', '中途暫停過', '曾經生氣或不想繼續'], rec.reactions)],
      [choices('r-verify', '理解驗證結果', 'radio',
        ['能說明方法', '能用在新句子', '還需要再練習', '這次還沒做驗證'], [rec.verify])],
      area('r-note', 'note', '其他觀察（選填）', 2, '')
    ));

    var output = el('textarea', { id: 'r-output', rows: '10', readonly: 'readonly', 'aria-label': '產生的提示詞', placeholder: '填寫上方資料後，提示詞會出現在這裡' });
    var status = el('p', { id: 'r-status', 'class': 'why', role: 'status' });
    var copyBtn = el('button', { id: 'r-copy', text: '複製提示詞' });

    var advice = el('textarea', { id: 'r-advice', rows: '6', placeholder: '拿到 Claude 的建議後，貼在這裡（選填）' });
    advice.value = rec.advice;
    var exportBtn = el('button', { id: 'r-export', 'class': 'primary', text: '匯出 PDF（列印／另存為 PDF）', onclick: exportPdf });
    var exportStatus = el('p', { id: 'r-export-status', 'class': 'why', role: 'status' });
    function refreshExport() {
      var ok = !!window.PromptBuilder.buildReviewDoc(rec, wiz.data, '', currentReview());
      exportBtn.disabled = !ok;
      exportStatus.textContent = ok ? '' : '請先填「你問了孩子什麼」、「孩子怎麼回答」或「孩子修改後的句子」其中一項。';
    }
    advice.addEventListener('input', function () { rec.advice = advice.value; refreshExport(); });

    function value(id) { return form.querySelector('#' + id).value; }
    function refresh() {
      rec.topic = value('r-topic');
      rec.original = value('r-original');
      rec.asked = value('r-asked');
      rec.said = value('r-said');
      rec.revised = value('r-revised');
      rec.note = value('r-note');
      rec.reactions = Array.prototype.map.call(
        form.querySelectorAll('input[name="r-reactions"]:checked'), function (i) { return i.value; });
      var verified = form.querySelector('input[name="r-verify"]:checked');
      rec.verify = verified ? verified.value : '';
      var text = window.PromptBuilder.buildFollowUp(rec);
      output.value = text;
      copyBtn.disabled = !text;
      status.textContent = text ? '' : '請至少填「你問了孩子什麼」、「孩子怎麼回答」或「孩子修改後的句子」其中一項。';
      refreshExport();
    }
    form.addEventListener('input', refresh);
    form.addEventListener('change', refresh);
    bindCopy(copyBtn, output, status);
    refresh();

    return el('div', {}, [
      stageHead('記錄與下次建議', '孩子改完後，由家長把這次的成果記下來。網頁整理成提示詞，貼到 Claude，請它建議下一次怎麼引導。'),
      el('p', { 'class': 'note', text: '網頁不會儲存你填的內容，重新整理就會消失。需要留存的話，請保存 Claude 的回覆。請不要寫孩子的姓名、學校、班級等可辨識身分的資料。' }),
      form,
      el('div', { 'class': 'card' }, [
        el('label', { 'for': 'r-output', text: '提示詞' }), output, copyBtn, status,
        el('p', { 'class': 'why', text: '提示詞是給 Claude 看的；Claude 的回覆是給你看的，不會貼回網頁。' })
      ]),
      el('div', { 'class': 'card' }, [
        el('h3', { text: '覆盤紀錄：存成 PDF 留存' }),
        el('p', { text: '上面填的內容，加上 Claude 給的下一次建議，可以整理成一份 PDF 留存。按「匯出 PDF」會開啟瀏覽器的列印視窗，把印表機選成「另存為 PDF」就會存成檔案。' }),
        el('label', { 'for': 'r-advice', text: 'Claude 給的下一次建議（選填，會一起存進 PDF）' }), advice,
        el('div', { 'class': 'stepper' }, [exportBtn]), exportStatus,
        el('p', { 'class': 'why', text: 'PDF 會自動縮小字體，盡量排在 2 頁內。列印視窗請取消勾選「頁首及頁尾」，PDF 才不會出現日期和這個網頁在你電腦裡的檔案路徑。' }),
        el('p', { 'class': 'note', text: 'PDF 會含有孩子的作文內容，請自己妥善保管，也請不要在紀錄中寫孩子的姓名、學校、班級。' })
      ]),
      reviewDetails(),
      el('div', { 'class': 'card' }, [
        el('p', { 'class': 'why', text: '下一次再寫作文時，回到第 1 步，帶著新的重點開始。' }),
        el('button', {
          id: 'w-reset', text: '清除這次的內容，重新開始',
          onclick: function () { wiz = newWiz(); setStage(1); }
        })
      ])
    ]);
  }

  function reviewDetails() {
    var a = findCase('A');
    var section = a && a.sections.filter(function (s) { return s.id === 'review'; })[0];
    if (!section || !section.review) return null;
    var box = el('details', { 'class': 'card more' }, [
      el('summary', { id: 'wiz-review', text: '家長回顧（一分鐘，每次只看一個改善重點）' }),
      renderReview(section.review)
    ]);
    // 回顧要連續按好幾次，重繪時要保持展開
    if (rv.open) box.setAttribute('open', '');
    box.addEventListener('toggle', function () { rv.open = box.open; });
    return box;
  }

  function renderWizard() {
    var stages = [renderWizPrepare, renderWizReply, renderWizGuide, renderWizRevise, renderWizRecord];
    return el('div', {}, [renderWizBar(), stages[wiz.stage - 1]()]);
  }

  // ---- 案例 A ----

  function renderCaseHead(c) {
    return el('div', { 'class': 'card case-head' }, [
      el('p', { 'class': 'mode', text: c.mode }),
      el('h2', { text: c.title }),
      el('p', { text: c.summary })
    ]);
  }

  function renderSectionTabs(c) {
    if (c.sections.length < 2) return null;
    var tabs = el('div', { 'class': 'tabs', role: 'tablist', 'aria-label': '教學步驟' });
    c.sections.forEach(function (s) {
      tabs.appendChild(el('button', {
        id: 'sec-' + s.id, role: 'tab', 'aria-selected': String(s.id === state.sectionId),
        text: s.title, onclick: function () { selectSection(s.id); }
      }));
    });
    return tabs;
  }

  function textBox(title, text) {
    return el('div', { 'class': 'text-box' }, [el('h4', { text: title }), el('p', { text: text })]);
  }

  function bulletList(items, cls) {
    return el('ul', cls ? { 'class': cls } : {}, items.map(function (t) { return el('li', { text: t }); }));
  }

  function renderCompare(s) {
    var rows = s.diffs.map(function (d) {
      return el('tr', {}, [
        el('td', { text: d.aspect }), el('td', { text: d.original }),
        el('td', { text: d.polished }), el('td', { text: d.verdict }), el('td', { text: d.note })
      ]);
    });
    var head = el('tr', {}, ['面向', '原稿', '潤飾稿', '建議', '說明'].map(function (t) { return el('th', { text: t }); }));
    var askSection = findCase(state.caseId).sections.filter(function (x) { return x.id === 'ask'; })[0];
    return el('div', {}, [
      el('div', { 'class': 'card' }, [
        el('h3', { text: '原稿與潤飾稿' }),
        el('div', { 'class': 'cols' }, [textBox('孩子的原稿', s.original), textBox('AI 潤飾稿（給家長看，不給孩子抄）', s.polished)])
      ]),
      el('div', { 'class': 'card' }, [el('h3', { text: '值得保留的優點' }), bulletList(s.strengths)]),
      el('div', { 'class': 'card' }, [
        el('h3', { text: '先留意一件事' }),
        el('p', { 'class': 'note', text: s.caution })
      ]),
      renderPointLearning(s, askSection),
      el('details', { 'class': 'card more' }, [
        el('summary', { id: 'all-diffs', text: '看全部差異（表格）' }),
        el('table', {}, [el('thead', {}, [head]), el('tbody', {}, rows)])
      ]),
      el('button', { id: 'to-guide', text: '看「作文重點」（四個面向）', onclick: function () { selectCase(GUIDE_ID); } })
    ]);
  }

  // 家長逐點學習：一次只顯示一個修改點（最多 3 個）。「再解釋」只切換事先寫好的內容。
  function renderPointLearning(s, askSection) {
    var points = s.points.slice(0, 3);
    var p = points[state.point] || points[0];
    var idx = askSection.steps.map(function (st) { return st.id; }).indexOf(p.stepId);
    var step = askSection.steps[idx];
    var last = state.point >= points.length - 1;

    var chips = el('div', { 'class': 'tabs', role: 'group', 'aria-label': '選擇修改點' }, points.map(function (pt, i) {
      return el('button', {
        id: 'pt-chip-' + i, 'aria-pressed': String(i === state.point), text: (i + 1) + '. ' + pt.label,
        onclick: function () { state.point = i; state.alt = false; state.focusId = 'pt-chip-' + i; render(); }
      });
    }));

    var list = el('dl', { 'class': 'point-list' });
    [
      ['1. 孩子原稿寫了什麼', p.original],
      ['2. AI 改了哪裡', p.change],
      ['3. 原本可以改善的地方', p.improvable],
      ['4. 為什麼這樣改', p.why],
      ['5. 用了什麼寫作技巧', p.technique]
    ].forEach(function (r) {
      list.appendChild(el('dt', { text: r[0] }));
      list.appendChild(el('dd', { text: r[1] }));
    });
    list.appendChild(el('dt', { text: '6. 可以怎麼問孩子' }));
    list.appendChild(el('dd', {}, [
      el('p', { 'class': 'big-question', text: '「' + step.question + '」' }),
      el('p', { 'class': 'why', text: '為什麼這樣問：' + step.purpose })
    ]));

    var alt = state.alt ? el('div', { 'class': 'card note' }, [
      el('h4', { text: '事先準備的另一種說法（不是即時 AI）' }),
      el('p', { text: p.alt.text }),
      el('p', { 'class': 'why', text: p.alt.example })
    ]) : null;

    var buttons = el('div', { 'class': 'stepper' }, [
      el('button', {
        id: 'pt-alt', 'aria-pressed': String(state.alt), text: state.alt ? '收起說明' : '請再解釋一次',
        onclick: function () { state.alt = !state.alt; state.focusId = 'pt-alt'; render(); }
      }),
      el('button', {
        id: 'pt-next', text: last ? '這是最後一個重點' : '我看懂了，下一個重點',
        onclick: function () { state.point += 1; state.alt = false; state.focusId = 'pt-next'; render(); }
      }),
      el('button', { id: 'pt-start', 'class': 'primary', text: '開始引導孩子', onclick: function () { selectSection('ask', idx); } })
    ]);
    buttons.querySelector('#pt-next').disabled = last;

    return el('div', { 'class': 'card ask-card' }, [
      el('h3', { text: '家長逐點學習：一次只看一個修改點' }),
      chips,
      el('p', { 'class': 'why', text: '修改點 ' + (state.point + 1) + '／' + points.length + '｜對應的作文面向：' + p.dimension + '（在「作文重點」頁可以看說明）' }),
      list, alt, buttons,
      el('p', { 'class': 'why', text: '按「我看懂了」只代表你準備好看下一個重點，不代表已經學會。不需要學完全部，也可以直接挑最適合孩子的一個，按「開始引導孩子」。' })
    ]);
  }

  function renderSteps(s) {
    var step = s.steps[state.step];
    var wrap = el('div', {}, []);
    if (s.intro) wrap.appendChild(el('p', { text: s.intro }));

    var card = el('div', { 'class': 'card' }, [
      el('p', { 'class': 'why', text: '第 ' + (state.step + 1) + ' 問，共 ' + s.steps.length + ' 問｜' + step.direction }),
      el('p', { 'class': 'question', text: step.question }),
      el('p', { 'class': 'why', text: '為什麼這樣問：' + step.purpose }),
      el('h3', { text: '孩子的反應是哪一種？' })
    ]);

    var picks = el('div', { 'class': 'tabs' });
    step.branches.forEach(function (b) {
      picks.appendChild(el('button', {
        id: 'br-' + b.key, 'aria-pressed': String(state.branch === b.key), text: b.label,
        onclick: function () { state.branch = b.key; state.focusId = 'br-' + b.key; render(); }
      }));
    });
    card.appendChild(picks);

    var chosen = step.branches.filter(function (b) { return b.key === state.branch; })[0];
    if (chosen) {
      card.appendChild(el('p', { text: '孩子可能的樣子：' + chosen.signal }));
      card.appendChild(el('p', {}, [
        el('span', { 'class': 'badge ' + chosen.action, text: '建議：' + ACTION_LABEL[chosen.action] })
      ]));
      card.appendChild(el('div', { 'class': 'say', text: '你可以說：' + chosen.say }));
      card.appendChild(el('p', { 'class': 'why', text: '原因：' + chosen.why }));
    }
    wrap.appendChild(card);

    var prev = el('button', { id: 'prev', text: '上一問', onclick: function () { go(-1); } });
    var next = el('button', { id: 'next', text: '下一問', onclick: function () { go(1); } });
    if (state.step === 0) prev.disabled = true;
    if (state.step === s.steps.length - 1) next.disabled = true;
    wrap.appendChild(el('div', { 'class': 'stepper' }, [prev, next]));
    return wrap;

    function go(delta) {
      state.step += delta;
      state.branch = null;
      state.focusId = delta > 0 ? 'next' : 'prev';
      render();
    }
  }

  function details(title, text) {
    return el('details', { 'class': 'more' }, [el('summary', { text: title }), el('p', { text: text })]);
  }

  // opts：doneText（最後一題的按鈕文字）、onDone（按下後做什麼）；案例 A 與新作文引導共用。
  function renderGuidedSteps(s, opts) {
    var options = opts || {};
    var doneText = options.doneText || '前往「孩子自己修改」';
    var onDone = options.onDone || function () { selectSection('revise'); };
    var step = s.steps[state.step];
    var last = state.step === s.steps.length - 1;

    var dots = el('div', { 'class': 'dots', role: 'img', 'aria-label': '第 ' + (state.step + 1) + ' 題，共 ' + s.steps.length + ' 題' },
      s.steps.map(function (st, i) {
        return el('span', { 'class': 'dot' + (i === state.step ? ' on' : i < state.step ? ' done' : '') });
      }));

    var ask = el('div', { 'class': 'card ask-card' }, [
      dots,
      el('p', { 'class': 'why', text: '第 ' + (state.step + 1) + ' 題｜' + step.direction + '｜現在這樣問孩子' }),
      el('p', { 'class': 'big-question', text: '「' + step.question + '」' }),
      details('為什麼這樣問？', step.purpose),
      step.ability ? details('這題在確認孩子的什麼？', step.ability) : null
    ]);

    var picks = el('div', { 'class': 'react-grid' });
    step.branches.forEach(function (b) {
      picks.appendChild(el('button', {
        id: 'br-' + b.key, 'class': 'react react-' + b.key, 'aria-pressed': String(state.branch === b.key), text: b.label,
        onclick: function () { state.branch = b.key; state.pause = false; state.focusId = 'br-' + b.key; render(); }
      }));
    });
    var react = el('div', { 'class': 'card' }, [el('h3', { text: '孩子怎麼回應？' }), picks]);

    var chosen = step.branches.filter(function (b) { return b.key === state.branch; })[0];
    var result;
    if (chosen) {
      result = el('div', { 'class': 'card result' }, [
        el('p', {}, [el('span', { 'class': 'badge ' + chosen.action, text: '建議：' + ACTION_LABEL[chosen.action] })]),
        el('p', { 'class': 'big-say', text: '下一句這樣說：' + chosen.say }),
        chosen.signal ? el('p', { 'class': 'why', text: '孩子可能的樣子：' + chosen.signal }) : null,
        details('為什麼這樣做？', chosen.why)
      ]);
    } else {
      result = el('p', { 'class': 'why', text: '先問上面的問題，等孩子回答後，選最接近的一項。' });
    }

    var pauseBtn = el('button', {
      id: 'pause', 'class': 'pause-btn', 'aria-pressed': String(state.pause), text: '我想暫停',
      onclick: function () { state.pause = !state.pause; state.focusId = 'pause'; render(); }
    });
    var pausePanel = state.pause ? el('div', { 'class': 'card note' }, [
      el('p', { 'class': 'big-say', text: '你可以說：' + s.pause.say }),
      el('p', { 'class': 'why', text: s.pause.why })
    ]) : null;

    var prev = el('button', { id: 'prev', text: '上一題', onclick: function () { go(-1); } });
    if (state.step === 0) prev.disabled = true;
    var next = el('button', {
      id: 'next', 'class': 'primary', text: last ? doneText : '下一題',
      onclick: function () { if (last) onDone(); else go(1); }
    });

    return el('div', {}, [
      ask, react, result, pausePanel,
      el('div', { 'class': 'stepper' }, [prev, pauseBtn, next])
    ]);

    function go(delta) {
      state.step += delta;
      state.branch = null;
      state.pause = false;
      state.focusId = delta > 0 ? 'next' : 'prev';
      render();
    }
  }

  function taskCard(t) {
    return el('div', { 'class': 'card ask-card' }, [
      el('h3', { text: t.title }),
      el('p', { 'class': 'big-say', text: t.text }),
      el('p', { 'class': 'note', text: t.note })
    ]);
  }

  function renderVerifyLayer(key, layer, withQuiz) {
    var kids = [el('h3', { text: layer.title })];
    if (withQuiz && layer.quiz) {
      var picked = vs.pick[key];
      kids.push(el('p', { 'class': 'big-say', text: layer.quiz.question }));
      layer.quiz.options.forEach(function (o, i) {
        kids.push(el('button', {
          id: 'vq-' + key + '-' + i, 'class': 'quiz-opt', 'aria-pressed': String(picked === i),
          text: String.fromCharCode(65 + i) + '. ' + o.text,
          onclick: function () { vs.pick[key] = i; state.focusId = 'vq-' + key + '-' + i; render(); }
        }));
      });
      if (picked !== null) {
        var chosen = layer.quiz.options[picked];
        var right = layer.quiz.options.filter(function (o) { return o.correct; })[0];
        kids.push(el('p', { 'class': chosen.correct ? 'quiz-ok' : 'quiz-no', role: 'status', text: (chosen.correct ? '選對了。' : '這個選項不太適合。') + chosen.why }));
        if (!chosen.correct) kids.push(el('p', { 'class': 'why', text: '比較適合的是：' + right.text + '。' + right.why }));
        kids.push(el('p', { 'class': 'why', text: '選對只代表這題看得出來，還要看實際能不能自己做到。' }));
      }
    }
    kids.push(el('p', { 'class': 'why', text: '自己勾選：' }));
    layer.checks.forEach(function (c, i) {
      var id = 'vc-' + key + '-' + i;
      var input = el('input', { type: 'checkbox', id: id });
      input.checked = !!vs.checks[key][i];
      input.addEventListener('change', function () { vs.checks[key][i] = input.checked; state.focusId = id; render(); });
      kids.push(el('div', {}, [input, el('label', { 'for': id, 'class': 'inline', text: ' ' + c })]));
    });
    var n = layer.checks.filter(function (c, i) { return vs.checks[key][i]; }).length;
    var msg = n === 0 ? '' : (n === layer.checks.length ? layer.ok : layer.low);
    kids.push(el('p', { 'class': 'why', role: 'status', text: '已勾 ' + n + '／' + layer.checks.length + ' 項。' + msg }));
    return el('div', { 'class': 'card' }, kids);
  }

  function renderVerifyLayers(layers, note, withQuiz) {
    return el('div', {}, [
      renderVerifyLayer('child', layers.child, withQuiz),
      renderVerifyLayer('parent', layers.parent, withQuiz),
      el('p', { 'class': 'note', text: note })
    ]);
  }

  // 一次只提出一個最值得改善的技巧：依題目順序，取第一個「還不太確定」。
  function renderReview(r) {
    var kids = [];
    r.questions.forEach(function (q, i) {
      var ans = rv.answers[i];
      function pick(v) {
        return function () { rv.answers[i] = v; rv.shown = false; state.focusId = 'rv-' + i + (v ? '-y' : '-n'); render(); };
      }
      kids.push(el('div', { 'class': 'review-row' }, [
        el('p', { 'class': 'review-q', text: (i + 1) + '. ' + q.q }),
        el('div', { 'class': 'tabs' }, [
          el('button', { id: 'rv-' + i + '-y', 'aria-pressed': String(ans === true), text: '是', onclick: pick(true) }),
          el('button', { id: 'rv-' + i + '-n', 'aria-pressed': String(ans === false), text: '還不太確定', onclick: pick(false) })
        ])
      ]));
    });
    kids.push(el('p', { 'class': 'review-q', text: r.modeTitle }));
    kids.push(el('div', { 'class': 'tabs' }, r.modes.map(function (m, i) {
      return el('button', {
        id: 'rv-mode-' + i, 'aria-pressed': String(rv.mode === i), text: m,
        onclick: function () { rv.mode = i; rv.shown = false; state.focusId = 'rv-mode-' + i; render(); }
      });
    })));
    kids.push(el('button', {
      id: 'rv-show', 'class': 'primary', text: '看這次最值得改善的一項',
      onclick: function () { rv.shown = true; state.focusId = 'rv-show'; render(); }
    }));

    if (rv.shown) {
      var answered = r.questions.every(function (q, i) { return rv.answers[i] === true || rv.answers[i] === false; });
      var first = -1;
      r.questions.forEach(function (q, i) { if (first < 0 && rv.answers[i] === false) first = i; });
      var result = [];
      if (!answered) {
        result.push(el('p', { text: '還有題目沒回答，請先回答完再看。' }));
      } else if (first >= 0) {
        result.push(el('h4', { text: '這次最值得改善的一項' }), el('p', { 'class': 'big-say', text: r.questions[first].q }), el('p', { text: r.questions[first].tip }));
      } else {
        result.push(el('p', { 'class': 'big-say', text: r.allOk }));
      }
      if (rv.mode !== null) result.push(el('p', { 'class': 'why', text: '這次的引導方式：' + r.modes[rv.mode] + '。' + r.modeNote }));
      var growth = answered && window.PromptBuilder.summarizeReview(currentReview()).growth;
      if (growth) result.push(growthBadge(growth));
      kids.push(el('div', { 'class': 'card result', role: 'status' }, result));
    }
    return el('div', { 'class': 'card' }, kids);
  }

  function renderVocab(v) {
    var head = el('tr', {}, ['孩子常用的詞', '想表達', '白話替代詞', '可學的成語', '再晚一點的詞'].map(function (t) { return el('th', { text: t }); }));
    var rows = v.rows.map(function (r) {
      return el('tr', {}, [
        el('td', { text: r.childWord }), el('td', { text: r.meaning }),
        el('td', { text: r.alternatives.join('、') }), el('td', { text: r.idioms.join('、') }),
        el('td', { text: r.later.join('、') })
      ]);
    });
    return el('div', { 'class': 'card' }, [
      el('h3', { text: v.title }),
      el('p', { 'class': 'why', text: '怎麼用：' }),
      el('ol', {}, v.steps.map(function (t) { return el('li', { text: t }); })),
      el('table', {}, [el('thead', {}, [head]), el('tbody', {}, rows)]),
      el('p', { 'class': 'note', text: v.note })
    ]);
  }

  function renderList(s) {
    var wrap = el('div', {}, []);
    if (s.intro) wrap.appendChild(el('p', { text: s.intro }));
    if (s.task) wrap.appendChild(taskCard(s.task));
    (s.items || []).forEach(function (it) {
      wrap.appendChild(el('div', { 'class': 'card' }, [el('h3', { text: it.title }), el('p', { text: it.text })]));
    });
    if (s.layers) wrap.appendChild(renderVerifyLayers(s.layers, s.note, true));
    if (s.review) wrap.appendChild(renderReview(s.review));
    if (s.vocab) wrap.appendChild(renderVocab(s.vocab));
    if (s.donts && s.donts.length) {
      wrap.appendChild(el('div', { 'class': 'card' }, [el('h3', { text: '請避免' }), bulletList(s.donts, 'donts')]));
    }
    if (s.link) {
      wrap.appendChild(el('button', {
        id: 'link-' + s.link.tool, 'class': 'primary', text: s.link.text,
        onclick: function () {
          if (s.link.tool === WIZ_ID) wiz.stage = s.link.stage || 1;
          selectCase(s.link.tool);
        }
      }));
    }
    return wrap;
  }

  function renderSection(s) {
    if (s.type === 'compare') return renderCompare(s);
    if (s.type === 'steps') return s.guided ? renderGuidedSteps(s) : renderSteps(s);
    return renderList(s);
  }

  // 首頁最上方的入口：一眼就看得到「貼作文」的地方
  function openEssayInput() {
    state.caseId = WIZ_ID;
    state.sectionId = null;
    state.step = 0;
    state.branch = null;
    state.pause = false;
    wiz.stage = 1;
    state.focusId = 'p-original';
    render();
  }

  function startCard() {
    return el('div', { 'class': 'card start-card' }, [
      el('h2', { text: '有一篇孩子的新作文嗎？' }),
      el('p', { text: '把作文貼上來，網頁會一步一步陪你：準備問題、引導孩子、記錄這次的成果。' }),
      el('button', { id: 'start-essay', 'class': 'primary big-btn', text: '貼上孩子的作文，開始', onclick: openEssayInput }),
      el('p', { 'class': 'why', text: '第一次使用？也可以先看下面的「案例 A」，走一遍示範。' })
    ]);
  }

  function render() {
    var app = document.getElementById('app');
    app.textContent = '';
    if (state.caseId === WIZ_ID || state.caseId === GUIDE_ID || state.caseId === TEACHER_ID) {
      app.appendChild(renderCaseTabs());
      app.appendChild(state.caseId === WIZ_ID ? renderWizard()
        : state.caseId === GUIDE_ID ? renderWritingGuide() : renderTeacherView());
      var tab = document.getElementById(state.focusId);
      if (tab) tab.focus();
      state.focusId = null;
      return;
    }
    var c = findCase(state.caseId);
    if (!c) {
      app.appendChild(el('p', { text: '案例資料沒有載入，請確認 examples 資料夾的檔案都在。' }));
      return;
    }
    if (!state.sectionId) state.sectionId = c.sections[0].id;
    var section = c.sections.filter(function (s) { return s.id === state.sectionId; })[0] || c.sections[0];

    if (section.id === c.sections[0].id) app.appendChild(startCard());
    app.appendChild(renderCaseTabs());
    if (!section.guided) app.appendChild(renderCaseHead(c));
    var sectionTabs = renderSectionTabs(c);
    if (sectionTabs) app.appendChild(sectionTabs);
    if (!section.guided) app.appendChild(el('h2', { text: section.title }));
    app.appendChild(renderSection(section));

    if (state.focusId) {
      var f = document.getElementById(state.focusId);
      if (f) f.focus();
      state.focusId = null;
    }
  }

  var first = getCases()[0];
  if (first) selectCase(first.id);
  else render();
})();
