import EditorPage from "@/timeline/EditorPage";

/**
 * 多轨时间线编排工作台。
 * 时间内核（整数 tick + 有理数帧率）、乐观并发、删除策略、持久化撤销、
 * 冻结渲染等实现见 src/timeline、src/store 与 @timeline/core。
 */
const Timeline = () => {
  return <EditorPage />;
};

export default Timeline;
