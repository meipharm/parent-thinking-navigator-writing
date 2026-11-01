// 範例回覆：用案例 A 的內容組成「Claude 會回覆的 JSON」，讓使用者不用 Claude 也能試走整個流程。
(function () {
  var A = window.CASES && window.CASES.A;
  if (!A) return;

  function section(id) { return A.sections.filter(function (s) { return s.id === id; })[0]; }
  var compare = section('compare');
  var ask = section('ask');
  var revise = section('revise');
  var verify = section('verify');

  var reply = {
    strengths: compare.strengths,
    cautions: [compare.caution],
    questions: ask.steps.map(function (st) {
      var reactions = {};
      st.branches.forEach(function (b) {
        reactions[b.key] = { signal: b.signal, action: b.action, say: b.say, why: b.why };
      });
      return { direction: st.direction, question: st.question, purpose: st.purpose, ability: st.ability, reactions: reactions };
    }),
    revise: revise.items.map(function (i) { return i.title + '：' + i.text; }),
    verify: verify.items.map(function (i) { return i.title + '：' + i.text; }),
    vocab: revise.vocab.rows.map(function (r) {
      return { childWord: r.childWord, alternatives: r.alternatives, idioms: r.idioms, later: r.later };
    })
  };

  window.SAMPLE_REPLY_TEXT = '```json\n' + JSON.stringify(reply, null, 2) + '\n```';
})();
