/* =========================================================
   수행평가 테스트 데이터 (evaluation.sql 실행 후 실행)
   - 학교: 테스트중학교 / 반: 1-1 / 학생 3명
   - 학생 테스트 계정: 테스트중학교 · 1-1 · 1번 · 확인코드 111111
   - 다시 실행하면 테스트중학교 데이터를 지우고 새로 만듭니다.
========================================================= */
do $$
declare
  v_task bigint;
  v_item bigint;
  v_s1 bigint; v_s2 bigint; v_s3 bigint;
begin
  delete from public.eval_tasks where school = '테스트중학교';
  delete from public.eval_students where school = '테스트중학교';

  insert into public.eval_students (school, class_name, number, name, access_code)
  values ('테스트중학교', '1-1', 1, '홍길동', '111111') returning id into v_s1;
  insert into public.eval_students (school, class_name, number, name, access_code)
  values ('테스트중학교', '1-1', 2, '김민지', '222222') returning id into v_s2;
  insert into public.eval_students (school, class_name, number, name, access_code)
  values ('테스트중학교', '1-1', 3, '이준호', '333333') returning id into v_s3;

  insert into public.eval_tasks (school, title, target, weight_pct, published)
  values ('테스트중학교', '가. 생활 속 인공지능 찾아 사례 조사 및 발표', '1학년', 30, true)
  returning id into v_task;

  -- 내용의 적절성 (30)
  insert into public.eval_items (task_id, sort, name, max_score) values (v_task, 1, '내용의 적절성', 30) returning id into v_item;
  insert into public.eval_item_levels (item_id, sort, description, score) values
    (v_item, 1, '사례 3가지를 조사하고 긍정적, 부정적 측면을 작성하고 발표함.', 30),
    (v_item, 2, '사례 2가지를 조사하고 긍정적, 부정적 측면을 작성하고 발표함.', 25),
    (v_item, 3, '사례 1가지를 조사하고 긍정적, 부정적 측면을 작성함.', 20),
    (v_item, 4, '사례를 조사하여 작성함.', 15),
    (v_item, 5, '보고서를 작성하지 못함.', 10);

  -- 창의성 및 완성도 (20)
  insert into public.eval_items (task_id, sort, name, max_score) values (v_task, 2, '창의성 및 완성도', 20) returning id into v_item;
  insert into public.eval_item_levels (item_id, sort, description, score) values
    (v_item, 1, '전체 구성이 체계적이고 창의적인 아이디어가 드러나며 완성도가 매우 높음.', 20),
    (v_item, 2, '전체 구성이 비교적 잘 갖추어져 있고 창의성과 완성도가 높음.', 15),
    (v_item, 3, '기본적인 구성은 갖추었으나 창의성이나 완성도가 미흡함.', 10),
    (v_item, 4, '구성이 미흡하고 창의성이 드러나지 않으며 완성도가 낮음.', 5);

  -- 수업 참여도 (40)
  insert into public.eval_items (task_id, sort, name, max_score) values (v_task, 3, '수업 참여도', 40) returning id into v_item;
  insert into public.eval_item_levels (item_id, sort, description, score) values
    (v_item, 1, '인공지능 개념 탐구 및 독후활동에 모두 참여함.', 40),
    (v_item, 2, '인공지능 개념 탐구 및 독후활동에 1회 참여하지 못함.', 30),
    (v_item, 3, '인공지능 개념 탐구 및 독후활동에 2회 참여하지 못함.', 20),
    (v_item, 4, '인공지능 개념 탐구 및 독후활동에 3회 이상 참여하지 못함.', 10);

  -- 자기평가 및 성찰 (10)
  insert into public.eval_items (task_id, sort, name, max_score) values (v_task, 4, '자기평가 및 성찰', 10) returning id into v_item;
  insert into public.eval_item_levels (item_id, sort, description, score) values
    (v_item, 1, '잘한점, 부족한점, 개선방안을 분명하게 제시함.', 10),
    (v_item, 2, '잘한점과 부족한점을 적절하게 제시함.', 9),
    (v_item, 3, '활동에 대한 자기평가를 하였으나 내용이 간단하거나 성찰이 부분적으로 이루어짐.', 8),
    (v_item, 4, '자기 평가에 참여하지 못함.', 7);

  -- 점수: (학생, 채점 요소 순서, 고른 기준 순서)
  insert into public.eval_scores (student_id, item_id, level_id)
  select x.sid, i.id, l.id
  from (values
    (v_s1, 1, 1), (v_s1, 2, 2), (v_s1, 3, 1), (v_s1, 4, 2),   -- 홍길동 30+15+40+9 = 94
    (v_s2, 1, 2), (v_s2, 2, 1), (v_s2, 3, 2), (v_s2, 4, 1),   -- 김민지 25+20+30+10 = 85
    (v_s3, 1, 3), (v_s3, 3, 3)                                 -- 이준호 일부만 채점 (20+20)
  ) as x(sid, item_sort, level_sort)
  join public.eval_items i on i.task_id = v_task and i.sort = x.item_sort
  join public.eval_item_levels l on l.item_id = i.id and l.sort = x.level_sort;
end $$;
