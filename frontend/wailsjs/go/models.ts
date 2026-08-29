export namespace main {
	
	export class AgentConfigResult {
	    exists: boolean;
	    content: string;
	
	    static createFrom(source: any = {}) {
	        return new AgentConfigResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.exists = source["exists"];
	        this.content = source["content"];
	    }
	}
	export class BrowserEndpoint {
	    baseURL: string;
	    token: string;
	
	    static createFrom(source: any = {}) {
	        return new BrowserEndpoint(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.baseURL = source["baseURL"];
	        this.token = source["token"];
	    }
	}
	export class ConsentResultDTO {
	    name: string;
	    version: string;
	    state: string;
	    detail?: string;
	    tools: string[];
	    declared_capabilities: string[];
	    declared_allowed_hosts: string[];
	    declared_allowed_paths: string[];
	    declared_extensions: string[];
	    declared_unresolved: boolean;
	    declared_unresolved_reason?: string;
	    declared_error?: string;
	    granted_capabilities: string[];
	    granted_allowed_hosts: string[];
	    granted_allowed_paths: string[];
	    granted_extensions: string[];
	    pending_convergence: boolean;
	    convergence_detail?: string;
	
	    static createFrom(source: any = {}) {
	        return new ConsentResultDTO(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.version = source["version"];
	        this.state = source["state"];
	        this.detail = source["detail"];
	        this.tools = source["tools"];
	        this.declared_capabilities = source["declared_capabilities"];
	        this.declared_allowed_hosts = source["declared_allowed_hosts"];
	        this.declared_allowed_paths = source["declared_allowed_paths"];
	        this.declared_extensions = source["declared_extensions"];
	        this.declared_unresolved = source["declared_unresolved"];
	        this.declared_unresolved_reason = source["declared_unresolved_reason"];
	        this.declared_error = source["declared_error"];
	        this.granted_capabilities = source["granted_capabilities"];
	        this.granted_allowed_hosts = source["granted_allowed_hosts"];
	        this.granted_allowed_paths = source["granted_allowed_paths"];
	        this.granted_extensions = source["granted_extensions"];
	        this.pending_convergence = source["pending_convergence"];
	        this.convergence_detail = source["convergence_detail"];
	    }
	}
	export class GateableToolDTO {
	    name: string;
	    description: string;
	
	    static createFrom(source: any = {}) {
	        return new GateableToolDTO(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.description = source["description"];
	    }
	}
	export class ModelInfo {
	    model: string;
	    context_length: number;
	    profile: string;
	
	    static createFrom(source: any = {}) {
	        return new ModelInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.model = source["model"];
	        this.context_length = source["context_length"];
	        this.profile = source["profile"];
	    }
	}
	export class PluginDTO {
	    name: string;
	    version: string;
	    state: string;
	    detail?: string;
	    tools: string[];
	    declared_capabilities: string[];
	    declared_allowed_hosts: string[];
	    declared_allowed_paths: string[];
	    declared_extensions: string[];
	    declared_unresolved: boolean;
	    declared_unresolved_reason?: string;
	    declared_error?: string;
	    granted_capabilities: string[];
	    granted_allowed_hosts: string[];
	    granted_allowed_paths: string[];
	    granted_extensions: string[];
	
	    static createFrom(source: any = {}) {
	        return new PluginDTO(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.version = source["version"];
	        this.state = source["state"];
	        this.detail = source["detail"];
	        this.tools = source["tools"];
	        this.declared_capabilities = source["declared_capabilities"];
	        this.declared_allowed_hosts = source["declared_allowed_hosts"];
	        this.declared_allowed_paths = source["declared_allowed_paths"];
	        this.declared_extensions = source["declared_extensions"];
	        this.declared_unresolved = source["declared_unresolved"];
	        this.declared_unresolved_reason = source["declared_unresolved_reason"];
	        this.declared_error = source["declared_error"];
	        this.granted_capabilities = source["granted_capabilities"];
	        this.granted_allowed_hosts = source["granted_allowed_hosts"];
	        this.granted_allowed_paths = source["granted_allowed_paths"];
	        this.granted_extensions = source["granted_extensions"];
	    }
	}
	export class SearchHit {
	    path: string;
	    line: number;
	    snippet: string;
	
	    static createFrom(source: any = {}) {
	        return new SearchHit(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.line = source["line"];
	        this.snippet = source["snippet"];
	    }
	}
	export class WorkspaceEntry {
	    name: string;
	    isDir: boolean;
	    size: number;
	
	    static createFrom(source: any = {}) {
	        return new WorkspaceEntry(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.isDir = source["isDir"];
	        this.size = source["size"];
	    }
	}
	export class WorkspaceFile {
	    kind: string;
	    text: string;
	    dataURI: string;
	    lang: string;
	
	    static createFrom(source: any = {}) {
	        return new WorkspaceFile(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.kind = source["kind"];
	        this.text = source["text"];
	        this.dataURI = source["dataURI"];
	        this.lang = source["lang"];
	    }
	}

}

