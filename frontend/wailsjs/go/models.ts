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

