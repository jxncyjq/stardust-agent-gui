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

}

