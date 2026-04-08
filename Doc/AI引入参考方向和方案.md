# AI引入参考方向和方案

## 一、参考项目分析：JChatMind

### 1.1 项目概述

**JChatMind** 是一个基于 Spring AI 框架构建的 Java AI Agent 智能体系统，由 [youngyangyang04/JChatMind](https://github.com/youngyangyang04/JChatMind) 开源。该项目实现了完整的 AI Agent 能力，包括：

- **Think-Execute 循环机制**：多轮规划 + 多轮工具调用 + 状态管理（THINKING/EXECUTING/DONE/ERROR）
- **工具调用框架**：固定工具 + 可选工具分类管理，工具自动注册，可扩展
- **RAG 知识库**：PostgreSQL + pgvector 向量检索，Markdown 文档解析分块 + Embedding 入库
- **多模型切换**：ChatClientRegistry 注册表模式，支持 DeepSeek/智谱 AI 等模型动态切换
- **SSE 实时推送**：Agent 执行状态实时可视化（THINKING/EXECUTING/DONE）

### 1.2 技术栈

| 层次 | 技术 |
|------|------|
| 框架 | Spring Boot + Spring AI |
| AI模型 | DeepSeek / 智谱 AI（可扩展） |
| 向量数据库 | PostgreSQL + pgvector |
| 实时通信 | SSE（Server-Sent Events） |
| 前端 | TypeScript + React |

### 1.3 核心架构

```
用户请求 → Controller → AgentService → Agent Loop（Think-Execute循环）
                                           ├── LLM调用（ChatClient）
                                           ├── 工具调用（ToolRegistry）
                                           ├── 知识库检索（RAG + pgvector）
                                           └── 状态推送（SSE）
```

---

## 二、UCS系统AI引入方向

### 2.1 方向一：无人机集群智能协同任务调度（推荐优先实现）

**目标**：引入 AI Agent 实现多无人机复杂任务的智能规划、分配和执行。

**应用场景**：
- 区域搜索任务：AI 自动规划搜索路径，分配无人机覆盖区域
- 目标追踪任务：AI 根据目标移动方向动态调整无人机编队
- 巡检任务：AI 根据地形、天气、电量等因素优化巡检路线
- 应急救援：AI 根据灾情信息快速规划搜救方案

**实现方案**：

```
任务创建 → AI Agent 分析任务 → Think-Execute Loop
    │
    ├── Think: 分析任务目标、约束条件、可用资源
    │     ├── 无人机电量、位置、能力
    │     ├── 地形、天气、禁飞区
    │     └── 任务优先级、时间限制
    │
    ├── Execute: 调用工具执行
    │     ├── PathPlanningTool: 路径规划
    │     ├── DroneAssignTool: 无人机分配
    │     ├── CommandSendTool: 发送飞行指令
    │     ├── TelemetryQueryTool: 查询遥测数据
    │     └── WeatherQueryTool: 查询天气信息
    │
    └── Monitor: 实时监控执行状态
          ├── 检测异常（无人机离线、电量不足）
          ├── 动态调整方案（重新分配任务）
          └── SSE推送执行状态到前端
```

**与JChatMind的结合点**：
- 复用 Think-Execute 循环机制作为任务调度核心
- 复用工具调用框架，注册 UCS 专用工具（路径规划、指令下发等）
- 复用 SSE 实时推送机制，将 Agent 决策过程推送到前端
- 复用多模型切换架构，支持不同场景使用不同模型

### 2.2 方向二：无人机知识库与智能问答

**目标**：构建无人机操控知识库，支持自然语言查询和智能辅助决策。

**应用场景**：
- 操作员询问"当前风速下哪些无人机可以安全飞行？"
- 自动生成任务报告和飞行日志总结
- 故障诊断："px4_3 的电池电压下降异常，可能原因是什么？"
- 培训辅助：新操作员通过问答系统学习操作流程

**实现方案**：
- 利用 JChatMind 的 RAG 架构，将无人机操作手册、故障排查指南、飞行规程等文档向量化存储
- 结合实时遥测数据，回答涉及当前状态的查询
- pgvector 已在 UCS 系统的 PostgreSQL 中可直接启用

### 2.3 方向三：异常检测与自主决策

**目标**：AI 实时监控遥测数据，自动检测异常并做出应急决策。

**应用场景**：
- 电池电量不足时自动规划返航路线
- 检测到通信中断时自动切换到备用链路
- 检测到禁飞区接近时自动调整航线
- 无人机编队中某架故障时自动重新分配任务

**实现方案**：
```
遥测数据流 → 异常检测模块 → AI Agent 决策
                                  ├── 评估风险等级
                                  ├── 生成应急方案
                                  ├── 执行应急指令
                                  └── 通知操作员（SSE推送）
```

---

## 三、技术实现方案

### 3.1 系统架构设计

```
┌─────────────────────────────────────────────────────┐
│                    前端（React）                      │
│  ┌──────────┐ ┌──────────┐ ┌──────────────────────┐ │
│  │ 任务面板  │ │ AI对话框  │ │ Agent执行状态面板     │ │
│  └──────────┘ └──────────┘ └──────────────────────┘ │
│        ↕ REST/WS      ↕ SSE           ↕ SSE         │
├─────────────────────────────────────────────────────┤
│                  后端（Spring Boot）                   │
│  ┌──────────────────────────────────────────────┐   │
│  │            AI Agent Service                   │   │
│  │  ┌─────────┐ ┌──────────┐ ┌──────────────┐  │   │
│  │  │AgentLoop│ │ToolReg   │ │ChatClientReg │  │   │
│  │  │Think    │ │PathPlan  │ │DeepSeek      │  │   │
│  │  │Execute  │ │DroneCtrl │ │Qwen          │  │   │
│  │  │Monitor  │ │Telemetry │ │GLM           │  │   │
│  │  └─────────┘ └──────────┘ └──────────────┘  │   │
│  │           ↕                    ↕              │   │
│  │  ┌──────────────┐  ┌──────────────────┐     │   │
│  │  │ RAG Service  │  │ Task Scheduler   │     │   │
│  │  │ pgvector     │  │ Mission Planner  │     │   │
│  │  └──────────────┘  └──────────────────┘     │   │
│  └──────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────┤
│              现有 UCS 基础设施                        │
│  ┌──────────┐ ┌──────────┐ ┌──────────────────┐    │
│  │PostgreSQL│ │  Redis   │ │  Kafka           │    │
│  │+pgvector │ │          │ │  (遥测+命令)      │    │
│  └──────────┘ └──────────┘ └──────────────────┘    │
│  ┌──────────────────────────────────────────┐      │
│  │         DDS Gateway (ROS2/PX4)           │      │
│  └──────────────────────────────────────────┘      │
└─────────────────────────────────────────────────────┘
```

### 3.2 模块划分

| 模块 | 职责 | 对应JChatMind组件 |
|------|------|------------------|
| `ucs-ai-agent` | Agent Loop核心（Think-Execute循环） | AgentService |
| `ucs-ai-tools` | UCS专用工具集（路径规划、指令下发等） | ToolRegistry |
| `ucs-ai-rag` | 知识库管理（文档解析、向量存储、检索） | RAG Service |
| `ucs-ai-model` | 多模型管理（ChatClientRegistry） | ChatClientRegistry |
| `ucs-ai-sse` | 实时状态推送 | SSE Service |

### 3.3 工具集设计

```java
// UCS AI Agent 工具集示例
@Component
public class UcsToolRegistry {

    // 路径规划工具
    @Tool("根据起点、终点和约束条件规划飞行路径")
    PathResult planPath(double startLat, double startLon,
                        double endLat, double endLon,
                        List<NoFlyZone> constraints);

    // 无人机分配工具
    @Tool("根据任务需求和无人机状态分配最优无人机")
    List<String> assignDrones(TaskRequirement task,
                              List<DroneStatus> available);

    // 发送飞行指令工具
    @Tool("向指定无人机发送飞行控制指令")
    CommandResult sendCommand(String uavId, String command,
                              Map<String, Object> params);

    // 遥测数据查询工具
    @Tool("查询指定无人机的实时遥测数据")
    TelemetryData queryTelemetry(String uavId);

    // 天气查询工具
    @Tool("查询指定区域的天气信息")
    WeatherInfo queryWeather(double lat, double lon);

    // 任务状态查询工具
    @Tool("查询当前所有进行中的任务状态")
    List<TaskStatus> queryActiveTasks();
}
```

### 3.4 Agent Loop 设计

```java
@Service
public class UcsMissionAgentService {

    private static final int MAX_STEPS = 20;

    public MissionResult executeMission(MissionRequest request) {
        AgentState state = AgentState.THINKING;
        int step = 0;

        while (state != AgentState.DONE && state != AgentState.ERROR
               && step < MAX_STEPS) {
            step++;

            switch (state) {
                case THINKING:
                    // 调用LLM分析任务，生成执行计划
                    ThinkResult think = llmThink(request, context);
                    if (think.needsToolCall()) {
                        state = AgentState.EXECUTING;
                    } else {
                        state = AgentState.DONE;
                    }
                    ssePublish(state, think);
                    break;

                case EXECUTING:
                    // 执行工具调用
                    ToolResult result = executeTool(think.getToolCall());
                    context.addToolResult(result);
                    // 回到思考阶段，评估工具执行结果
                    state = AgentState.THINKING;
                    ssePublish(state, result);
                    break;
            }
        }

        return buildResult(context);
    }
}
```

---

## 四、实施路线图

### Phase 1：基础框架搭建（2-3周）
- [ ] 创建 `ucs-ai-agent` 模块
- [ ] 集成 Spring AI 框架
- [ ] 实现 ChatClientRegistry（先接入 DeepSeek）
- [ ] 实现基础 Agent Loop（Think-Execute循环）
- [ ] 实现 SSE 实时推送通道

### Phase 2：工具集开发（2-3周）
- [ ] 实现 DroneCommandTool（调用现有命令下发接口）
- [ ] 实现 TelemetryQueryTool（查询实时遥测数据）
- [ ] 实现 PathPlanningTool（基础路径规划）
- [ ] 实现 DroneAssignTool（无人机分配策略）
- [ ] 前端集成 AI 对话面板和任务面板

### Phase 3：RAG知识库（1-2周）
- [ ] PostgreSQL 启用 pgvector 扩展
- [ ] 实现文档导入（Markdown解析、分块、Embedding）
- [ ] 实现相似度检索
- [ ] 集成到 Agent Loop

### Phase 4：复杂任务调度（2-4周）
- [ ] 实现多无人机协同任务规划
- [ ] 实现任务执行监控与动态调整
- [ ] 实现异常检测与自主决策
- [ ] 端到端测试与优化

---

## 五、关键技术决策

| 决策点 | 推荐方案 | 原因 |
|--------|---------|------|
| AI框架 | Spring AI | 与现有 Spring Boot 技术栈一致，JChatMind已验证 |
| LLM模型 | DeepSeek（主） + 智谱AI（备） | 中文能力强，API稳定，成本合理 |
| 向量数据库 | PostgreSQL + pgvector | 复用现有PG，不增加运维复杂度 |
| 实时通信 | SSE | 单向推送足够，比WebSocket更简单（WebSocket已用于遥测） |
| 工具调用 | Spring AI @Tool 注解 | 声明式定义，自动注册，JChatMind已验证 |

---

## 六、风险与注意事项

1. **LLM延迟**：大模型调用有数秒延迟，不适合时间敏感的紧急操作。紧急情况应使用预定义规则引擎兜底。
2. **模型幻觉**：AI可能生成不合理的飞行方案，需要在工具层做参数校验和安全限制。
3. **成本控制**：大量Agent调用会产生API费用，需要设计缓存和调用频率限制。
4. **安全边界**：AI决策必须经过安全检查层（禁飞区、电量阈值、最大飞行距离等硬性约束）。
5. **降级策略**：当AI服务不可用时，系统应能降级为手动控制模式。
