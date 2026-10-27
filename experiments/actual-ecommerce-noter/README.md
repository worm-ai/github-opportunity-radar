# Actual 订单工具的既有能力基线

目的：先验证已有后继工具，避免将它已经完成的商品拆分作为新组合机会；检查分批发货和同额候选是否需要进一步研究。实验不是新金融产品，不连接真实预算或电商账户。

上游固定为 `rr4444/actual-ecommerce-noter@52aa8ada3fbd602b80df52cd10fe95206488bcdb`，CLI Git Blob `582b07eee3e183ae7834899b876d1b7754fa9e92`。下载原始文件并核对 Blob 与 SHA-256，执行时再次核对，不改匹配、解析、输出或 dry-run 逻辑。

Windows x64，先完成项目依赖安装与包编译，再执行：

```powershell
node experiments/actual-ecommerce-noter/prepare.mjs
powershell -NoProfile -ExecutionPolicy Bypass -File experiments/actual-ecommerce-noter/prepare-runtime.ps1
node experiments/actual-ecommerce-noter/run.mjs
```

Python 3.12.10 embeddable、requests 2.32.5 及四个精确版本依赖安装于忽略的 `.data/experiments/actual-ecommerce-noter/python`，不改系统 Python。Python ZIP 按首次实测下载的固定 SHA-256 核对，未单独核验发布者签名；wheel 按 PyPI 元数据的 SHA-256 核对并记录 URL，后续优先核对已下载缓存。本机仅部分 PyPI DNS 地址可达，下载器在已解析的 IPv4 地址间尝试，始终保留原主机名、SNI 和证书验证。

真实上游 CLI 读取合成 CSV，并用真实 requests 访问绑定到 127.0.0.1 随机端口的临时只读 Actual HTTP API 替身。每次 CLI 进程只收到必要 Windows 环境和 UTF-8 设置，不传入本项目密钥、代理或真实账本环境。固定 `--dry-run json --format amazon --amount-tolerance 0 --days 3`，记录每条 HTTP 请求；任何写方法、异常退出或标准错误均使验证失败。未安装/启动 Actual、actual-http-api、Amazon 扩展、Web UI 或 AI 分类器；CLI 到替身接口通过不等于真实服务的接口兼容已验证。

九次独立运行：单笔、商品拆分、多订单合并、一单两次发货扣款、同日同额候选正序/反序、唯一商品退款、等价商品退款及非 Amazon 商户负例。输入全部人工合成，不代表发生率；CSV 字段按当前 CLI 解析器构造，不代表所有官方导出格式。金额容差固定为零，以隔离结构和歧义问题；未覆盖默认 1 英镑容差、多币种、真实记账或执行模式。

结果在 `.data/experiments/actual-ecommerce-noter/result.json`，保留全部输入、原始标准输出和请求记录；不要用实验夹具修改机会或市场状态。运行结果评审后执行 `node experiments/actual-ecommerce-noter/publish.mjs`，将五份带哈希产物放入现有只读“技术实测”。

已有拆分、合并与唯一退款能力通过；合成的一单两次发货扣款均未匹配；同日同额订单调换行序会改变单个输出候选；等价商品退款保留 `Candidates:` 信息。输出已经称作 potential matches，不能声称工具承诺了确定匹配，更不能从这些边界直接推出新商机。
