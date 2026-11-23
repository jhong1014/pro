/* =========================================================
   API : 예전 Code.gs 함수들을 같은 이름·같은 결과 형태로 구현
========================================================= */
const API = {
  async getInitialData(){
    const today = seoulToday();
    const results = await Promise.all([ API.getRecords(today, ''), API.getTodos(), loadSchoolList() ]);
    return { today: today, schools: results[2], day: results[0], todos: results[1] };
  },

  async getSchools(){
    invalidateSchools();
    return loadSchoolList();
  },

  async getRecords(dateStr, school){
    let q = sb.from('records').select('*').eq('school_year', settings.year).eq('semester', settings.semester).eq('date', dateStr);
    if (school) q = q.eq('school', school);
    const results = await Promise.all([ q.then(must), loadHolidayList(), loadSchoolList() ]);
    const list = results[0].map(toRec).sort(byPeriod);
    return { date: dateStr, records: list, schools: results[2], holiday: findHoliday(dateStr, results[1]) };
  },

  async getRecordsRange(s, e, school){
    const results = await Promise.all([
      fetchAll(function(){
        let q = sb.from('records').select('*').eq('school_year', settings.year).eq('semester', settings.semester).gte('date', s).lte('date', e).order('date').order('id');
        if (school) q = q.eq('school', school);
        return q;
      }),
      loadHolidayList(),
      loadSchoolList()
    ]);
    const list = results[0].map(toRec).sort(function(a, b){
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      const pa = parseInt(a.period, 10), pb = parseInt(b.period, 10);
      if (!isNaN(pa) && !isNaN(pb) && pa !== pb) return pa - pb;
      return 0;
    });
    return { start: s, end: e, records: list, schools: results[2], holidays: results[1] };
  },

  async getMonthSummary(year, month, school){
    const start = year + '-' + ('0' + month).slice(-2) + '-01';
    const end = fmt(new Date(year, month, 0));
    const results = await Promise.all([
      fetchAll(function(){
        let q = sb.from('records').select('date,school').eq('school_year', settings.year).eq('semester', settings.semester).gte('date', start).lte('date', end).order('id');
        if (school) q = q.eq('school', school);
        return q;
      }),
      loadHolidayList(),
      loadSchoolList()
    ]);
    const summary = {};
    results[0].forEach(function(r){
      if (!summary[r.date]) summary[r.date] = { count: 0, schools: [] };
      summary[r.date].count++;
      if (summary[r.date].schools.indexOf(r.school) < 0) summary[r.date].schools.push(r.school);
    });
    return { year: year, month: month, summary: summary, schools: results[2], holidays: results[1] };
  },

  async addRecord(rec){
    if (!rec.date) throw new Error('날짜가 올바르지 않습니다.');
    if (!rec.school) throw new Error('학교명을 입력하세요.');
    must(await sb.from('records').insert({
      school_year: settings.year, semester: settings.semester,
      date: rec.date, school: rec.school,
      period: rec.period || null, class_name: rec.cls || null, progress: rec.progress || null
    }));
    invalidateSchools();
    return API.getRecords(rec.date, '');
  },

  async updateRecord(id, rec){
    if (!rec.date) throw new Error('날짜가 올바르지 않습니다.');
    if (!rec.school) throw new Error('학교명을 입력하세요.');
    must(await sb.from('records').update({
      date: rec.date, school: rec.school,
      period: rec.period || null, class_name: rec.cls || null, progress: rec.progress || null
    }).eq('id', id));
    invalidateSchools();
    return API.getRecords(rec.date, '');
  },

  async deleteRecord(id){
    must(await sb.from('records').delete().eq('id', id));
    invalidateSchools();
    return true;
  },

  async getHolidays(){
    return loadHolidayList();
  },

  async addHoliday(h){
    if (!h || !h.start) throw new Error('시작일을 입력하세요.');
    const end = h.end || h.start;
    if (end < h.start) throw new Error('종료일이 시작일보다 앞섭니다.');
    must(await sb.from('holidays').insert({ start_date: h.start, end_date: end, reason: h.reason || '' }));
    return loadHolidayList();
  },

  async deleteHoliday(id){
    must(await sb.from('holidays').delete().eq('id', id));
    return loadHolidayList();
  },

  /* 기초 시간표 일괄 생성 (공휴일 자동 제외) */
  async generateTimetable(spec){
    if (!spec || !spec.school) throw new Error('학교명을 입력하세요.');
    if (!spec.start || !spec.end) throw new Error('기간을 입력하세요.');
    if (!spec.items || !spec.items.length) throw new Error('요일별 시간표를 최소 1개 입력하세요.');
    if (spec.start > spec.end) throw new Error('시작일이 종료일보다 늦습니다.');

    const holidays = await loadHolidayList();
    const skipHol = spec.skipHolidays !== false;

    const existing = {};
    if (!spec.overwrite){
      const rows = await fetchAll(function(){
        return sb.from('records').select('date,period,class_name')
          .eq('school_year', settings.year).eq('semester', settings.semester).eq('school', spec.school).gte('date', spec.start).lte('date', spec.end).order('id');
      });
      rows.forEach(function(r){ existing[r.date + '|' + (r.period || '') + '|' + (r.class_name || '')] = true; });
    }

    const toInsert = [];
    let skippedHoliday = 0;
    const cur = parseD(spec.start), last = parseD(spec.end);
    while (cur <= last){
      const dow = cur.getDay();
      const dateStr = fmt(cur);
      const isHol = skipHol && findHoliday(dateStr, holidays);
      spec.items.forEach(function(it){
        if (Number(it.dow) !== dow) return;
        if (isHol){ skippedHoliday++; return; }
        const key = dateStr + '|' + (it.period || '') + '|' + (it.cls || '');
        if (existing[key]) return;
        toInsert.push({
          school_year: settings.year, semester: settings.semester,
          date: dateStr, school: spec.school,
          period: it.period || null, class_name: it.cls || null, progress: it.progress || null
        });
        existing[key] = true;
      });
      cur.setDate(cur.getDate() + 1);
    }

    if (!toInsert.length){
      return { inserted: 0, skippedHoliday: skippedHoliday,
        message: '생성된 일정이 없습니다.' + (skippedHoliday ? ' (휴일 ' + skippedHoliday + '건 제외)' : '') };
    }
    for (let i = 0; i < toInsert.length; i += 500){
      must(await sb.from('records').insert(toInsert.slice(i, i + 500)));  // 한 번에 묶어서 저장
    }
    invalidateSchools();
    return { inserted: toInsert.length, skippedHoliday: skippedHoliday,
      message: toInsert.length + '건 생성' + (skippedHoliday ? ' · 휴일 ' + skippedHoliday + '건 제외' : '') };
  },

  /* 수업시수 집계 */
  async getClassStats(c){
    if (!c.start || !c.end) throw new Error('기간을 입력하세요.');
    const results = await Promise.all([
      fetchAll(function(){
        let q = sb.from('records').select('date,school,class_name').eq('school_year', settings.year).eq('semester', settings.semester).gte('date', c.start).lte('date', c.end).order('id');
        if (c.school) q = q.eq('school', c.school);
        return q;
      }),
      loadSchoolList()
    ]);
    const groupBy = c.groupBy || 'school';
    const dowLabels = ['일','월','화','수','목','금','토'];
    const groups = {};
    results[0].forEach(function(r){
      const cls = r.class_name || '';
      let key, extra;
      if (groupBy === 'school-class'){
        key = r.school + ' | ' + (cls || '(반없음)'); extra = { school: r.school, cls: cls };
      } else if (groupBy === 'school-day'){
        const dl = dowLabels[parseD(r.date).getDay()];
        key = r.school + ' | ' + dl + '요일'; extra = { school: r.school, day: dl };
      } else {
        key = r.school; extra = { school: r.school };
      }
      if (!groups[key]) groups[key] = Object.assign({ key: key, count: 0 }, extra);
      groups[key].count++;
    });
    const arr = Object.keys(groups).map(function(k){ return groups[k]; });
    arr.sort(function(a, b){
      if (a.school !== b.school) return a.school.localeCompare(b.school);
      return b.count - a.count;
    });
    return { start: c.start, end: c.end, total: results[0].length, groups: arr, schools: results[1] };
  },

  /* Todo (진행 중인 것만) */
  async getTodos(){
    const data = must(await sb.from('todos').select('*').eq('done', false).order('created_at'));
    return data.map(function(t){ return { row: t.id, text: t.content, createdAt: seoulDateTime(t.created_at) }; });
  },
  async addTodo(text){
    const t = String(text || '').trim();
    if (!t) throw new Error('할 일 내용을 입력하세요.');
    must(await sb.from('todos').insert({ content: t }));
    return API.getTodos();
  },
  async completeTodo(id){
    must(await sb.from('todos').update({ done: true }).eq('id', id));
    return API.getTodos();
  },
  async deleteTodo(id){
    must(await sb.from('todos').delete().eq('id', id));
    return API.getTodos();
  }
};

/* =========================================================
   google.script.run 호환 연결부
   - 아래 화면 코드는 예전처럼 google.script.run.xxx()를 부르지만
     실제로는 위 API(Supabase)가 실행됩니다.
========================================================= */
function makeRunner(){
  let onOk = null, onFail = null;
  const runner = new Proxy({}, {
    get: function(_, name){
      if (name === 'withSuccessHandler') return function(f){ onOk = f; return runner; };
      if (name === 'withFailureHandler') return function(f){ onFail = f; return runner; };
      return function(){
        const args = arguments;
        Promise.resolve()
          .then(function(){
            if (!API[name]) throw new Error('알 수 없는 함수: ' + String(name));
            return API[name].apply(null, args);
          })
          .then(function(v){ if (onOk) onOk(v); })
          .catch(function(e){
            console.error(e);
            if (onFail) onFail(e); else toast(e.message || '오류가 발생했습니다.', 'err');
          });
      };
    }
  });
  return runner;
}
const google = { script: { get run(){ return makeRunner(); } } };

