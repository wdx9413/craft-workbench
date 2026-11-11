export function environmentGuidance(env, platform) {
  if (!/^[A-Z_][A-Z0-9_]*$/i.test(env)) return { command: '', message: '环境变量名格式不正确，请在高级选项中修改。' };
  if (/win/i.test(platform) && !/darwin/i.test(platform)) return { command: `$env:${env} = '你的Key'`, message: '请从同一终端启动 Craft；命令可能保存在终端历史中。' };
  if (/mac|darwin/i.test(platform)) return { command: `launchctl setenv ${env} '你的Key'`, message: '退出并重新打开 Craft 后，请检查配置是否生效；命令可能保存在终端历史中。' };
  if (/linux/i.test(platform)) return { command: `export ${env}='你的Key'`, message: '请从同一终端启动 Craft；命令可能保存在终端历史中。' };
  return { command: '', message: `请为 Craft 设置环境变量 ${env}，然后重新启动。` };
}

/** Model registration owns a bounded metadata draft, never a pasted credential. */
export function createModelSetup(presets, api, storage) {
  let draft = null, revision = 0, generation = 0, discoveryGeneration = 0, saving = null, onboarding = false;
  const onboardingKey = 'craft.onboardingProvider';
  const clearOnboardingDraft = () => { try { storage?.removeItem(onboardingKey); } catch (_) { /* storage unavailable */ } };
  const preset = (key) => presets.find((item) => item.key === key);
  const trim = (value) => String(value ?? '').trim();
  function opened() { if (!draft) throw new Error('请先打开模型配置'); return draft; }
  return {
    open(input = {}) {
      revision++;
      generation++;
      discoveryGeneration++;
      onboarding = input.isFirstRun === true;
      const editing = input.editing;
      let remembered = null;
      if (onboarding) { try { remembered = storage?.getItem(onboardingKey); } catch (_) { /* storage unavailable */ } }
      const selected = input.preset || (editing ? 'custom' : (preset(remembered) ? remembered : null));
      const defaults = preset(selected);
      draft = {
        step: input.step || (editing || (!input.preset && remembered && selected === remembered) ? 2 : 1), preset: selected,
        editing: editing ? { id: editing.id } : null,
        pricing: editing?.pricing ? structuredClone(editing.pricing) : null,
        name: trim(input.name || (editing && editing.name) || (defaults && defaults.label)),
        model: trim(input.model || (editing && editing.model)),
        baseUrl: trim(input.baseUrl || (editing && editing.baseUrl) || (defaults && defaults.baseUrl)),
        protocol: input.protocol || (editing && editing.protocol) || (defaults && defaults.protocol) || 'openai-compatible',
        env: input.env || (editing && editing.apiKeyEnv) || (defaults && defaults.env) || 'CRAFT_API_KEY',
        discoveredModels: [], discovery: null,
      };
      if (![1, 2, 3].includes(draft.step) || (selected && !defaults)) { draft = null; throw new Error('模型配置步骤或服务商无效'); }
    },
    view() { return structuredClone(opened()); },
    change(event) {
      const current = opened();
      const previous = JSON.stringify(current);
      if (event.type === 'select') {
        const selected = preset(event.key);
        if (!selected) throw new Error('服务商不存在');
        Object.assign(current, { preset: selected.key, name: selected.label, model: selected.models[0] || '', baseUrl: selected.baseUrl,
          protocol: selected.protocol, env: selected.env, step: 2, pricing: null });
        if (onboarding) { try { storage?.setItem(onboardingKey, selected.key); } catch (_) { /* storage unavailable */ } }
      } else if (event.type === 'fields') {
        const destination = [current.baseUrl, current.protocol, current.env].join('|');
        for (const key of ['name', 'baseUrl', 'protocol', 'env']) if (event[key] !== undefined) current[key] = trim(event[key]);
        if (event.pricing !== undefined) current.pricing = event.pricing;
        current.baseUrl = current.baseUrl.replace(/\/+$/, '');
        if ([current.baseUrl, current.protocol].join('|') !== destination.split('|').slice(0, 2).join('|')) current.pricing = null;
        if ([current.baseUrl, current.protocol, current.env].join('|') !== destination) {
          current.discoveredModels = [];
          current.discovery = null;
        }
      } else if (event.type === 'next') {
        if (!current.preset) throw new Error('请先选择服务商');
        if (current.step === 1) current.step = 2;
        else {
          const model = trim(event.model);
          if (current.model !== model) current.pricing = null;
          current.model = model;
          if (!current.model) throw new Error('请选择或填写一个模型');
          current.step = 3;
        }
      } else if (event.type === 'back') current.step = Math.max(1, current.step - 1);
      else throw new Error('模型配置操作无效');
      if (JSON.stringify(current) !== previous) { revision++; discoveryGeneration++; }
    },
    async discover() {
      const current = opened(), version = revision, ticket = ++discoveryGeneration;
      current.discovery = { status: 'loading', message: '正在向服务商查询模型列表…' };
      try {
        const response = await api('/api/config/models/discover', { method: 'POST', body: {
          baseUrl: current.baseUrl, protocol: current.protocol, apiKeyEnv: current.env,
        } });
        if (!draft || ticket !== discoveryGeneration || version !== revision) return { current: false };
        current.discovery = response;
        current.discoveredModels = Array.isArray(response.models) ? response.models.slice(0, 500) : [];
        return { current: true, status: response.status, models: current.discoveredModels };
      } catch (_) {
        if (!draft || ticket !== discoveryGeneration || version !== revision) return { current: false };
        current.discovery = { status: 'network_error', message: '模型列表请求失败；请检查配置和 Runtime 连接，或手动填写模型 ID。' };
        current.discoveredModels = [];
        return { current: true, status: 'network_error', models: [] };
      }
    },
    async save() {
      const current = opened(), version = revision;
      if (saving && saving.generation === generation) throw new Error('模型配置正在保存');
      const body = { id: current.editing ? current.editing.id : current.preset, name: current.name || preset(current.preset)?.label || '', protocol: current.protocol,
        baseUrl: current.baseUrl, model: current.model, apiKeyEnv: current.env, supportsTools: true };
      if (!body.id || !/^[a-z0-9-]+$/.test(body.id)) throw new Error('服务商标识只能用小写字母、数字和短横线');
      if (!body.model) throw new Error('请选择或填写一个模型');
      if (!/^https?:\/\//.test(body.baseUrl)) throw new Error('服务地址要以 http:// 或 https:// 开头');
      const endpoint = new URL(body.baseUrl);
      if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash) throw new Error('服务地址不能包含密钥或认证参数');
      if (!['openai-compatible', 'anthropic'].includes(body.protocol)) throw new Error('接口协议无效');
      if (!/^[A-Z_][A-Z0-9_]*$/i.test(body.apiKeyEnv)) throw new Error('环境变量名格式不正确');
      if (current.pricing) {
        const price = current.pricing;
        if (!trim(price.version)) throw new Error('请填写价格版本');
        for (const key of ['input_usd_per_million', 'output_usd_per_million']) if (typeof price[key] !== 'number' || !Number.isFinite(price[key]) || price[key] < 0) throw new Error('请输入有效的非负模型单价');
        if (price.cached_input_usd_per_million !== undefined && (!Number.isFinite(price.cached_input_usd_per_million) || price.cached_input_usd_per_million < 0)) throw new Error('缓存单价无效');
        body.pricing = structuredClone(price);
      } else if (current.editing) body.pricing = null;
      const ticket = { generation }; saving = ticket;
      let result;
      try {
        await api(current.editing ? '/api/config/models/' + encodeURIComponent(current.editing.id) : '/api/config/models',
          { method: current.editing ? 'PATCH' : 'POST', body });
        result = { current: version === revision, status: 'saved', provider: body.id, name: body.name, editing: !!current.editing };
        if (onboarding && result.current) clearOnboardingDraft();
      } catch (error) {
        if (version !== revision) result = { current: false, status: 'failed' };
        else throw error;
      } finally { if (saving === ticket) saving = null; }
      return result;
    },
    clearOnboardingDraft,
  };
}
