-- ============================================================================
-- 数据库级完整性防线：拒绝悬空引用（dangling references）
-- 即使应用层校验被绕过，PostgreSQL 触发器也会阻止把引用了不存在/已删素材
-- （或文档内不存在的锚点片段）的时间线文档写入。
-- ============================================================================

CREATE OR REPLACE FUNCTION timeline_doc_integrity() RETURNS trigger AS $$
DECLARE
  clip       jsonb;
  media_id   text;
  anchor_id  text;
  track_id   text;
  clip_ids   jsonb;
  track_ids  jsonb;
  media_ids  jsonb;
  fps_text   text;
  fps_num    bigint;
  fps_den    bigint;
  ticks_pf   numeric;
BEGIN
  -- 结构存在性
  IF NOT (jsonb_typeof(NEW.doc) = 'object')
     OR NOT (NEW.doc ? 'clips')
     OR NOT (NEW.doc ? 'tracks') THEN
    RAISE EXCEPTION 'timeline_doc_integrity: 文档缺少 clips/tracks 结构';
  END IF;

  track_ids := (
    SELECT jsonb_agg(elem->>'id') FROM jsonb_array_elements(NEW.doc->'tracks') AS elem
  );
  clip_ids := (
    SELECT jsonb_agg(elem->>'id') FROM jsonb_array_elements(NEW.doc->'clips') AS elem
  );
  SELECT COALESCE(jsonb_object_agg(id, true), '{}'::jsonb) INTO media_ids FROM "Media";

  -- 帧率必须可在 240000 tick 时间基上整除表达
  fps_text := NEW.doc->>'fps';
  IF fps_text ~ '^[0-9]+/[0-9]+$' THEN
    fps_num := split_part(fps_text, '/', 1)::bigint;
    fps_den := split_part(fps_text, '/', 2)::bigint;
    IF fps_den = 0 THEN
      RAISE EXCEPTION 'timeline_doc_integrity: 帧率分母为零';
    END IF;
    ticks_pf := 240000.0 * fps_den / fps_num;
    IF ticks_pf <> trunc(ticks_pf) THEN
      RAISE EXCEPTION 'timeline_doc_integrity: 帧率 % 无法整除 240000 tick 时间基', fps_text;
    END IF;
  END IF;

  FOR clip IN SELECT elem FROM jsonb_array_elements(NEW.doc->'clips') AS elem
  LOOP
    -- 所有时间字段必须为非负整数 tick（禁止浮点秒落库）
    IF jsonb_typeof(clip->'start') <> 'number'
       OR (clip->>'start')::numeric <> trunc((clip->>'start')::numeric)
       OR (clip->>'start')::numeric < 0 THEN
      RAISE EXCEPTION 'timeline_doc_integrity: 片段 % 的 start 必须是非负整数 tick', clip->>'id';
    END IF;
    IF (clip->>'duration')::numeric <= 0
       OR (clip->>'duration')::numeric <> trunc((clip->>'duration')::numeric) THEN
      RAISE EXCEPTION 'timeline_doc_integrity: 片段 % 的 duration 必须为正整数 tick', clip->>'id';
    END IF;

    -- 轨道引用必须存在
    track_id := clip->>'trackId';
    IF track_ids IS NULL OR NOT (track_ids ? track_id) THEN
      RAISE EXCEPTION 'timeline_doc_integrity: 片段 % 引用了不存在的轨道 %', clip->>'id', track_id;
    END IF;

    -- 素材引用必须在 Media 表存在（悬空引用拒绝）
    media_id := clip->>'mediaId';
    IF media_id IS NOT NULL AND media_id <> 'null' THEN
      IF NOT (media_ids ? media_id) THEN
        RAISE EXCEPTION 'timeline_doc_integrity: 片段 % 引用了不存在的素材 %（悬空引用被数据库拒绝）', clip->>'id', media_id;
      END IF;
    END IF;

    -- 锚点必须指向文档内存在的片段（anchorClipId 为字符串或 null）
    IF jsonb_typeof(clip->'anchorClipId') = 'string' THEN
      anchor_id := clip->>'anchorClipId';
    ELSE
      anchor_id := NULL;
    END IF;
    IF anchor_id IS NOT NULL
       AND (clip_ids IS NULL OR NOT (clip_ids ? anchor_id)) THEN
      RAISE EXCEPTION 'timeline_doc_integrity: 片段 % 锚定到了不存在的片段 %（悬空锚点）', clip->>'id', anchor_id;
    END IF;

    -- 入点必须为非负整数 tick
    IF jsonb_typeof(clip->'sourceIn') <> 'number'
       OR (clip->>'sourceIn')::numeric <> trunc((clip->>'sourceIn')::numeric)
       OR (clip->>'sourceIn')::numeric < 0 THEN
      RAISE EXCEPTION 'timeline_doc_integrity: 片段 % 的 sourceIn 必须是非负整数 tick', clip->>'id';
    END IF;

    -- 转场重叠必须为正整数 tick
    IF jsonb_typeof(clip->'transitionIn') = 'object' THEN
      IF (clip->'transitionIn'->>'overlap')::numeric <= 0
         OR (clip->'transitionIn'->>'overlap')::numeric <> trunc((clip->'transitionIn'->>'overlap')::numeric) THEN
        RAISE EXCEPTION 'timeline_doc_integrity: 片段 % 的转场重叠必须为正整数 tick', clip->>'id';
      END IF;
    END IF;

    -- 关键点位置必须是 [0, duration] 内的整数 tick
    IF jsonb_typeof(clip->'keyPoints') = 'array' THEN
      PERFORM 1 FROM jsonb_array_elements(clip->'keyPoints') AS kp
      WHERE (kp->>'at')::numeric < 0
         OR (kp->>'at')::numeric > (clip->>'duration')::numeric
         OR (kp->>'at')::numeric <> trunc((kp->>'at')::numeric);
      IF FOUND THEN
        RAISE EXCEPTION 'timeline_doc_integrity: 片段 % 存在越界或非整数关键点', clip->>'id';
      END IF;
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_timeline_doc_integrity ON "Timeline";
CREATE TRIGGER trg_timeline_doc_integrity
  BEFORE INSERT OR UPDATE OF doc ON "Timeline"
  FOR EACH ROW EXECUTE FUNCTION timeline_doc_integrity();
